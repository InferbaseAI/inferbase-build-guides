/**
 * Per-visitor limits for an open endpoint, as fixed windows per minute and per day.
 *
 * In memory, so the counts are per server instance: right for one instance or a quickstart, and
 * an honest floor on serverless. For several instances, implement `Limiter` on a shared store
 * (Redis, Upstash, your database) and pass it to `checkLimits`. Spend is bounded regardless by the
 * API key's daily spend cap in Inferbase, which is the control that cannot be bypassed.
 */

export interface Limiter {
  /** Count one hit on `key` in a window of `windowMs`; return the count including this one. */
  hit(key: string, windowMs: number, now: number): number
}

export class MemoryLimiter implements Limiter {
  private windows = new Map<string, { start: number; count: number }>()

  hit(key: string, windowMs: number, now: number): number {
    const current = this.windows.get(key)
    if (!current || now - current.start >= windowMs) {
      this.windows.set(key, { start: now, count: 1 })
      if (this.windows.size > 50_000) this.prune(now, windowMs)
      return 1
    }
    current.count += 1
    return current.count
  }

  private prune(now: number, windowMs: number): void {
    for (const [key, w] of this.windows) if (now - w.start >= windowMs) this.windows.delete(key)
  }
}

export type LimitVerdict = { ok: true } | { ok: false; retryAfterSeconds: number; message: string }

const MINUTE = 60_000
const DAY = 86_400_000

export function checkLimits(
  limiter: Limiter,
  visitor: string,
  limits: { perMinute: number; perDay: number },
  now = Date.now(),
): LimitVerdict {
  if (limits.perMinute > 0 && limiter.hit(`m:${visitor}`, MINUTE, now) > limits.perMinute) {
    return { ok: false, retryAfterSeconds: 60, message: 'Too many messages. Please wait a minute and try again.' }
  }
  if (limits.perDay > 0 && limiter.hit(`d:${visitor}`, DAY, now) > limits.perDay) {
    return { ok: false, retryAfterSeconds: 3600, message: 'Daily message limit reached. Please come back tomorrow.' }
  }
  return { ok: true }
}

/** The visitor's address: the first X-Forwarded-For hop your platform appends, else a constant. */
export function visitorAddress(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for')
  return forwarded?.split(',')[0]?.trim() || headers.get('x-real-ip') || 'unknown'
}
