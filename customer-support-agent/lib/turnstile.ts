import { issueSession, verifySession } from './session'

/** Cloudflare Turnstile: a bot check before a visitor's first request, when configured. */
export async function verifyTurnstile(secret: string, token: string | undefined, ip: string): Promise<boolean> {
  if (!token) return false
  const body = new URLSearchParams({ secret, response: token, remoteip: ip })
  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body })
  if (!response.ok) return false
  const result = (await response.json()) as { success?: boolean }
  return result.success === true
}

/** What a request proves about its visitor: a session from an earlier check, or a fresh token. */
export interface VisitorProof {
  session?: unknown
  turnstileToken?: unknown
}

export type VisitorCheck = { ok: true; session?: string } | { ok: false }

/**
 * Every request is checked, not only the first message: a valid session passes, otherwise a fresh
 * Turnstile token passes and earns a new session. With no secret configured, everything passes.
 */
export async function checkVisitor(
  secret: string,
  proof: VisitorProof,
  ip: string,
  verify: typeof verifyTurnstile = verifyTurnstile,
): Promise<VisitorCheck> {
  if (!secret) return { ok: true }
  if (verifySession(secret, proof.session)) return { ok: true }
  const token = typeof proof.turnstileToken === 'string' ? proof.turnstileToken : undefined
  if (await verify(secret, token, ip)) return { ok: true, session: issueSession(secret) }
  return { ok: false }
}

/** The 403 body when the check is missing or has expired; the browser shows the check again. */
export const VERIFY_REQUIRED = { error: 'Please complete the check and send your message again.', code: 'verify' } as const
