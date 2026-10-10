import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * A visitor session: proof that this browser passed the Turnstile check recently.
 *
 * A Turnstile token is single-use, so it can cover one request. The chat route spends it on the
 * first message and hands back a session token, an expiry signed with a key derived from the
 * Turnstile secret, which every later message (and the support handoff) carries instead. Without
 * it, "later messages ride on the first one" would mean trusting the conversation the browser
 * sends, and a bot could skip the check by sending a made-up history. Stateless on purpose: any
 * instance can verify it, and there is nothing to store.
 */

export const SESSION_TTL_MS = 60 * 60 * 1000

function key(secret: string): Buffer {
  return createHmac('sha256', secret).update('support-agent-session-v1').digest()
}

function sign(secret: string, payload: string): string {
  return createHmac('sha256', key(secret)).update(payload).digest('base64url')
}

export function issueSession(secret: string, now = Date.now()): string {
  const payload = String(now + SESSION_TTL_MS)
  return `${payload}.${sign(secret, payload)}`
}

export function verifySession(secret: string, token: unknown, now = Date.now()): boolean {
  if (typeof token !== 'string') return false
  const [payload, signature, ...rest] = token.split('.')
  if (!payload || !signature || rest.length) return false
  const expected = Buffer.from(sign(secret, payload))
  const given = Buffer.from(signature)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false
  const expires = Number(payload)
  return Number.isFinite(expires) && now < expires
}
