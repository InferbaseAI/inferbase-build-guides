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
    ...options.turns,
  ]
  let usage: UsageReceipt | undefined
  // A model that reasons whatever it is asked can stream its thinking and stop with nothing to show
  // (MiniMax-M3 on Together, 2026-10-15): once anything is streamed, the API cannot fall back, so an
  // empty round is asked again here, once.
  let retried = false

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
      send({ type: 'tool', label: TOOLS[call.name]?.label ?? call.name })
      messages.push({ role: 'tool', tool_call_id: call.id, content: await runTool(account, call.name, call.arguments) })
    }
  }
  if (usage) send({ type: 'usage', usage })
}
