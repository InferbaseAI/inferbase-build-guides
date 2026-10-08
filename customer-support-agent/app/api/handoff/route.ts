import { config } from '@/lib/config'
import { checkLimits, MemoryLimiter, visitorAddress } from '@/lib/rate-limit'
import { verifyTurnstile } from '@/lib/turnstile'
import { validateTurns } from '@/lib/validate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const limiter = new MemoryLimiter()
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** "Contact support": the conversation goes to your support inbox by email, with the visitor's
 *  address as the reply-to, so answering it is replying to the email. */
export async function POST(request: Request): Promise<Response> {
  if (!config.handoff.enabled) return Response.json({ error: 'Support handoff is not configured.' }, { status: 501 })
  const ip = visitorAddress(request.headers)
  const limit = checkLimits(limiter, ip, { perMinute: 2, perDay: 5 })
  if (!limit.ok) return Response.json({ error: limit.message }, { status: 429 })

  let body: { email?: unknown; note?: unknown; messages?: unknown; turnstileToken?: string }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'The request body must be JSON.' }, { status: 400 })
  }
  const email = typeof body.email === 'string' ? body.email.trim() : ''
  if (!EMAIL.test(email) || email.length > 254) {
    return Response.json({ error: 'Enter a valid email address.' }, { status: 400 })
  }
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 2000) : ''
  const valid = validateTurns(body.messages, { maxChars: config.maxMessageChars, maxTurns: config.maxTurns + 1 })
  const transcript = valid.ok ? valid.turns : []

  if (config.turnstileSecret && !(await verifyTurnstile(config.turnstileSecret, body.turnstileToken, ip))) {
    return Response.json({ error: 'Please complete the check and try again.' }, { status: 403 })
  }

  const text = [
    `From: ${email}`,
    note ? `\nNote:\n${note}` : '',
    '\nConversation with the support assistant:\n',
    ...transcript.map((t) => `${t.role === 'user' ? 'Visitor' : 'Assistant'}:\n${t.content}\n`),
  ].join('\n')

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.handoff.resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: config.handoff.from,
      to: [config.handoff.to],
      reply_to: email,
      subject: `Support request from ${email}`,
      text,
    }),
  })
  if (!response.ok) {
    console.error('[handoff] email provider answered', response.status)
    return Response.json({ error: 'Your message could not be sent. Please email us directly.' }, { status: 502 })
  }
  return Response.json({ ok: true })
}
