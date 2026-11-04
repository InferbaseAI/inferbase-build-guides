/** What a visitor may send. Everything a browser posts is untrusted, so it is checked here. */

/** An account lookup an earlier answer made, carried back by the browser so a follow-up reads the
 *  same facts instead of the model's prose about them (2026-11-05). */
export interface Lookup {
  name: string
  result: string
}

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
  /** Assistant turns only, account mode only: the lookups behind that answer. */
  lookups?: Lookup[]
}

export type Validated = { ok: true; turns: ChatTurn[] } | { ok: false; message: string }

/** The most lookups one answer may carry, and the most characters each may hold (the tool cap). */
export const MAX_LOOKUPS_PER_TURN = 6
export const LOOKUP_RESULT_CAP = 8000
const LOOKUP_NAME = /^[a-z][a-z0-9_]{0,63}$/

function validateLookups(raw: unknown): Lookup[] | null | undefined {
  if (raw === undefined) return undefined
  if (!Array.isArray(raw) || raw.length > MAX_LOOKUPS_PER_TURN) return null
  const lookups: Lookup[] = []
  for (const item of raw) {
    const lookup = item as { name?: unknown; result?: unknown }
    if (typeof lookup?.name !== 'string' || !LOOKUP_NAME.test(lookup.name) || typeof lookup.result !== 'string') return null
    if (lookup.result.length > LOOKUP_RESULT_CAP) return null
    lookups.push({ name: lookup.name, result: lookup.result })
  }
  return lookups
}

export function validateTurns(input: unknown, limits: { maxChars: number; maxTurns: number }): Validated {
  if (!Array.isArray(input) || input.length === 0) return { ok: false, message: 'Send at least one message.' }
  if (input.length > limits.maxTurns * 2) {
    return { ok: false, message: 'This conversation is long. Please start a new one.' }
  }
  const turns: ChatTurn[] = []
  for (const [i, raw] of input.entries()) {
    const turn = raw as { role?: unknown; content?: unknown; lookups?: unknown }
    const expected = i % 2 === 0 ? 'user' : 'assistant'
    if (turn?.role !== expected || typeof turn.content !== 'string') {
      return { ok: false, message: 'The conversation is not in the expected shape.' }
    }
    if (expected === 'user' && turn.content.length > limits.maxChars) {
      return { ok: false, message: `Messages can be up to ${limits.maxChars} characters.` }
    }
    const lookups = expected === 'assistant' ? validateLookups(turn.lookups) : turn.lookups === undefined ? undefined : null
    if (lookups === null) return { ok: false, message: 'The conversation is not in the expected shape.' }
    turns.push({
      role: expected,
      content: turn.content.slice(0, expected === 'user' ? limits.maxChars : 8000),
      ...(lookups && lookups.length ? { lookups } : {}),
    })
  }
  if (turns[turns.length - 1].role !== 'user' || !turns[turns.length - 1].content.trim()) {
    return { ok: false, message: 'The last message must be a question.' }
  }
  return { ok: true, turns }
}
