import type OpenAI from 'openai'
import { runTool, TOOL_DEFINITIONS, TOOLS, type AccountClient } from './account-tools'
import { config } from './config'
import { addUsage, collectToolCalls, readChunk, type ChatEvent, type ToolCall, type UsageReceipt } from './events'
import { systemPrompt } from './prompt'
import type { IndexedPassage, Source } from './retrieval'
import type { ChatTurn } from './validate'

/**
 * One answer, streamed through `send`: a single model call, or in account mode a few, since the model
 * may ask for account lookups, which run here and go back to it until it answers (or the round limit
 * makes it answer with no tools). The chat route calls this with the person's account; the evaluation
 * calls it with a fixture account, so the same loop is what gets measured.
 *
 * Throws what the model call or the account throws (TokenExpired included); the caller words it.
 */
export async function answer(options: {
  client: OpenAI
  account: AccountClient | null
  turns: ChatTurn[]
  passages: IndexedPassage[]
  sources: Source[]
  send: (event: ChatEvent) => void
}): Promise<void> {
  const { client, account, send } = options
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content: systemPrompt(config.productName, options.passages, options.sources, config.comparisonsUrl, account !== null),
    },
    ...historyMessages(options.turns, account !== null),
  ]
  let usage: UsageReceipt | undefined
  // A model that reasons whatever it is asked can stream its thinking and stop with nothing to show
  // (MiniMax-M3 on Together, 2026-10-15): once anything is streamed, the API cannot fall back, so an
  // empty round is asked again here, once.
  let retried = false

  // A follow-up in account mode decides its lookups FIRST, in a call of its own, and the answer is
  // written with their results in hand. Left to itself, the model answered "how about the other
  // key?" from its earlier prose with figures no tool had returned (2026-11-04); a prompt rule did
  // not stop it, and `tool_choice: required` was forwarded to the provider and ignored (the decision
  // record shows it was sent, undowngraded, and no call came back). So the choice is made where it
  // cannot be skipped. A first question keeps the ordinary loop: the eval's 13 first-turn cases pass.
  if (account !== null && options.turns.some((t) => t.role === 'assistant')) {
    const decided = await decideLookups(client, messages, account, send)
    if (decided) usage = addUsage(usage, decided)
  }
  for (let round = 0; ; round++) {
    const withTools = account !== null && round < config.maxToolRounds
    const completion = await client.chat.completions.create({
      model: config.chatModel,
      stream: true,
      max_tokens: config.maxAnswerTokens,
      reasoning_effort: config.reasoningEffort,
      messages,
      ...(withTools ? { tools: TOOL_DEFINITIONS } : {}),
    })
    const calls = new Map<number, ToolCall>()
    let text = ''
    let failed = false
    for await (const chunk of completion) {
      collectToolCalls(calls, chunk)
      const event = readChunk(chunk)
      if (!event) continue
      if (event.type === 'usage') usage = addUsage(usage, event.usage)
      else {
        if (event.type === 'delta') text += event.text
        if (event.type === 'error') failed = true
        send(event)
      }
    }
    if (calls.size === 0 && !text.trim() && !failed) {
      if (!retried) {
        retried = true
        continue
      }
      send({ type: 'error', message: 'The assistant could not answer just now. Please try again.' })
      break
    }
    if (!account || calls.size === 0) break

    // Words the model wrote before its lookups ("Let me check") stay; the answer follows them.
    if (text && !text.endsWith('\n')) send({ type: 'delta', text: '\n\n' })
    const ordered = [...calls.values()]
    messages.push({
      role: 'assistant',
      content: text || null,
      tool_calls: ordered.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments } })),
    })
    for (const call of ordered) {
      messages.push({ role: 'tool', tool_call_id: call.id, content: await lookup(account, call, send) })
    }
  }
  if (usage) send({ type: 'usage', usage })
}

/** One lookup: tell the browser, run it, hand the result back for the browser to keep with the answer
 *  (`ChatTurn.lookups`), so a follow-up has the facts and not only the prose written from them. */
async function lookup(account: AccountClient, call: { name: string; arguments: string }, send: (e: ChatEvent) => void): Promise<string> {
  send({ type: 'tool', label: TOOLS[call.name]?.label ?? call.name })
  const result = await runTool(account, call.name, call.arguments)
  if (TOOLS[call.name]) send({ type: 'lookup', name: call.name, result })
  return result
}

/** How many lookups one decision may ask for; a question rarely needs more than two. */
export const MAX_DECIDED_LOOKUPS = 3

function decisionPrompt(): string {
  const tools = TOOL_DEFINITIONS.map((t) => {
    const params = Object.entries((t.function.parameters?.properties ?? {}) as Record<string, { description?: string }>)
      .map(([name, p]) => `${name}: ${p.description ?? ''}`)
      .join('; ')
    return `- ${t.function.name}: ${t.function.description}${params ? ` Arguments: ${params}` : ''}`
  })
  return [
    `You decide which account lookups, if any, the next answer needs. The person is signed in to their ${config.productName} account; the conversation so far follows, and the last message is the question to decide for.`,
    'Reply with JSON only, in this shape: {"lookups": [{"name": "<tool name>", "arguments": {}}]}. Use an empty list when the question is answered from the documentation or needs nothing from the account.',
    'Any question about the account itself (its requests, errors, spend, usage, API keys, connections, policies, how a request was routed) needs a lookup, even when an earlier answer mentioned the subject: earlier answers are not a source of account facts, and a follow-up about another key, model, project or period reads again.',
    'Tools:',
    ...tools,
  ].join('\n')
}

/** The lookups a decision text names, in the tool vocabulary; anything else is dropped. */
export function parseDecision(text: string): { name: string; arguments: string }[] {
  const body = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return []
  }
  const list = (parsed as { lookups?: unknown })?.lookups
  if (!Array.isArray(list)) return []
  const out: { name: string; arguments: string }[] = []
  for (const item of list) {
    const name = (item as { name?: unknown })?.name
    if (typeof name !== 'string' || !TOOLS[name] || out.some((o) => o.name === name)) continue
    const args = (item as { arguments?: unknown })?.arguments
    out.push({ name, arguments: JSON.stringify(args && typeof args === 'object' ? args : {}) })
    if (out.length === MAX_DECIDED_LOOKUPS) break
  }
  return out
}

/** Decide the lookups for a follow-up and run them, appending the calls and results to `messages`
 *  as if the model had asked for them. Returns the decision call's usage. A decision that cannot be
 *  read, or that names nothing, leaves the ordinary loop to do what it can. */
async function decideLookups(
  client: OpenAI,
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  account: AccountClient,
  send: (e: ChatEvent) => void,
): Promise<UsageReceipt | undefined> {
  const history = messages.filter((m) => m.role !== 'system')
  let text = ''
  let usage: UsageReceipt | undefined
  try {
    const completion = await client.chat.completions.create({
      model: config.chatModel,
      max_tokens: 300,
      reasoning_effort: config.reasoningEffort,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: decisionPrompt() }, ...history],
    })
    text = completion.choices[0]?.message?.content ?? ''
    usage = completion.usage as UsageReceipt | undefined
  } catch {
    return undefined
  }
  const decided = parseDecision(text)
  if (decided.length === 0) return usage
  const calls = decided.map((d, j) => ({ ...d, id: `decided-${j}` }))
  messages.push({
    role: 'assistant',
    content: null,
    tool_calls: calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments } })),
  })
  for (const call of calls) {
    messages.push({ role: 'tool', tool_call_id: call.id, content: await lookup(account, call, send) })
  }
  return usage
}

/**
 * The conversation so far, as the model reads it. In account mode an assistant turn that carried
 * lookups is replayed as the tool calls it made and their results, then its words, so the model
 * answers a follow-up from the same data. On 2026-11-04 a follow-up about a second API key was
 * answered with figures no tool had returned: the model saw only its earlier prose about the first
 * key. Lookups are dropped outside account mode: a visitor cannot plant account data.
 */
export function historyMessages(turns: ChatTurn[], account: boolean): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = []
  turns.forEach((turn, i) => {
    if (turn.role === 'assistant' && account && turn.lookups?.length) {
      const calls = turn.lookups.map((lookup, j) => ({ id: `lookup-${i}-${j}`, name: lookup.name, result: lookup.result }))
      messages.push({
        role: 'assistant',
        content: null,
        tool_calls: calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: '{}' } })),
      })
      for (const c of calls) messages.push({ role: 'tool', tool_call_id: c.id, content: c.result })
    }
    messages.push({ role: turn.role, content: turn.content })
  })
  return messages
}
