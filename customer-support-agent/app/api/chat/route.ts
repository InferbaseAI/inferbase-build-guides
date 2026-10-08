import { APIError } from 'openai'
import { config } from '@/lib/config'
import { encodeEvent, readChunk, type ChatEvent } from '@/lib/events'
import { inferbase } from '@/lib/inferbase'
import { systemPrompt } from '@/lib/prompt'
import { checkLimits, MemoryLimiter, visitorAddress } from '@/lib/rate-limit'
import { retrieve } from '@/lib/retrieval'
import { verifyTurnstile } from '@/lib/turnstile'
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
  let body: { messages?: unknown; turnstileToken?: string }
  try {
    body = await request.json()
  } catch {
    return refuse(400, 'The request body must be JSON.')
  }

  const valid = validateTurns(body.messages, { maxChars: config.maxMessageChars, maxTurns: config.maxTurns })
  if (!valid.ok) return refuse(400, valid.message)

  const limit = checkLimits(limiter, ip, { perMinute: config.ratePerMinute, perDay: config.ratePerDay })
  if (!limit.ok) return refuse(429, limit.message, { 'Retry-After': String(limit.retryAfterSeconds) })

  // A bot check on the first message of a session; later messages ride on it.
  if (config.turnstileSecret && valid.turns.length === 1) {
    if (!(await verifyTurnstile(config.turnstileSecret, body.turnstileToken, ip))) {
      return refuse(403, 'Please complete the check and send your message again.')
    }
  }

  // Search with the latest question plus the one before it, so a follow-up ("how do I set it?")
  // still finds the page the conversation is about.
  const userTurns = valid.turns.filter((t) => t.role === 'user').map((t) => t.content)
  const query = userTurns.slice(-2).join('\n')

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ChatEvent) => controller.enqueue(encodeEvent(event))
      try {
        const { passages, sources } = await retrieve(query, config.retrieval.topK)
        send({ type: 'sources', sources })

        const completion = await inferbase().chat.completions.create({
          model: config.chatModel,
          stream: true,
          max_tokens: config.maxAnswerTokens,
          messages: [
            { role: 'system', content: systemPrompt(config.productName, passages, sources) },
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
    if (error.status === 400 || error.status === 403) {
      // A guardrail refusal (for example a prompt-injection check) arrives as a 4xx with a reason.
      return 'This message could not be answered. Please rephrase it.'
    }
    return 'The assistant could not answer just now. Please try again.'
  }
  console.error('[chat]', error)
  return 'The assistant could not answer just now. Please try again.'
}
