/** Cloudflare Turnstile: a bot check on the first message of a session, when configured. */
export async function verifyTurnstile(secret: string, token: string | undefined, ip: string): Promise<boolean> {
  if (!token) return false
  const body = new URLSearchParams({ secret, response: token, remoteip: ip })
  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body })
  if (!response.ok) return false
  const result = (await response.json()) as { success?: boolean }
  return result.success === true
}
