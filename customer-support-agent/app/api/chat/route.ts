import { APIError } from 'openai'
import { config } from '@/lib/config'
import { encodeEvent, isGuardrailRefusal, readChunk, type ChatEvent } from '@/lib/events'
import { inferbase } from '@/lib/inferbase'
import { systemPrompt } from '@/lib/prompt'
import { checkLimits, MemoryLimiter, visitorAddress } from '@/lib/rate-limit'
import { retrieve } from '@/lib/retrieval'
import { checkVisitor, VERIFY_REQUIRED } from '@/lib/turnstile'
import { validateTurns } from '@/lib/validate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const limiter = new MemoryLimiter()

function refuse(status: number, message: string, headers: Record<string, string> = {}): Response {
  return Response.json({ error: message }, { status, headers })
}

/**
 * One answer: check the visitor, find the relevant docs, ask Inferbase, stream the answer back
 * with the sources it was given and the routing receipt Inferbase returns.
 */
export async function POST(request: Request): Promise<Response> {
  const ip = visitorAddress(request.headers)
  let body: { messages?: unknown; turnstileToken?: unknown; session?: unknown }
  try {
    body = await request.json()
  } catch {
    return refuse(400, 'The request body must be JSON.')
  }

  const valid = validateTurns(body.messages, { maxChars: config.maxMessageChars, maxTurns: config.maxTurns })
  if (!valid.ok) return refuse(400, valid.message)

  const limit = checkLimits(limiter, ip, { perMinute: config.ratePerMinute, perDay: config.ratePerDay })
  if (!limit.ok) return refuse(429, limit.message, { 'Retry-After': String(limit.retryAfterSeconds) })

  // The bot check: every message carries a session from an earlier check or a fresh token.
  const visitor = await checkVisitor(config.turnstileSecret, body, ip)
  if (!visitor.ok) return Response.json(VERIFY_REQUIRED, { status: 403 })

  // Search with the latest question plus the one before it, so a follow-up ("how do I set it?")
  // still finds the page the conversation is about.
  const userTurns = valid.turns.filter((t) => t.role === 'user').map((t) => t.content)
  const query = userTurns.slice(-2).join('\n')

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ChatEvent) => controller.enqueue(encodeEvent(event))
      if (visitor.session) send({ type: 'session', token: visitor.session })
      try {
        const { passages, sources } = await retrieve(query, config.retrieval.topK)
        send({ type: 'sources', sources })

        const completion = await inferbase().chat.completions.create({
          model: config.chatModel,
          stream: true,
          max_tokens: config.maxAnswerTokens,
          reasoning_effort: config.reasoningEffort,
          messages: [
            { role: 'system', content: systemPrompt(config.productName, passages, sources, config.comparisonsUrl) },
            ...valid.turns,
          ],
        })
        for await (const chunk of completion) {
          const event = readChunk(chunk)
          if (event) send(event)
        }
        send({ type: 'done' })
      } catch (error) {
        send({ type: 'error', message: describe(error) })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

/** What the visitor sees when an answer fails: plain words, never a stack or a key. */
function describe(error: unknown): string {
  if (error instanceof APIError) {
    if (error.status === 402) return 'The assistant has reached its usage limit for today. Please try again tomorrow.'
    if (error.status === 429) return 'The assistant is busy. Please try again in a minute.'
    if (isGuardrailRefusal(error.status, error.message)) return 'This message could not be answered. Please rephrase it.'
    // Anything else is ours to fix (a model outside the key's pool, a bad key): log it, say little.
    console.error('[chat]', error.status, error.message)
    return 'The assistant could not answer just now. Please try again.'
  }
  console.error('[chat]', error)
  return 'The assistant could not answer just now. Please try again.'
}
