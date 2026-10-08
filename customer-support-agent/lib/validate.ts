/** What a visitor may send. Everything a browser posts is untrusted, so it is checked here. */

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

export type Validated = { ok: true; turns: ChatTurn[] } | { ok: false; message: string }

export function validateTurns(input: unknown, limits: { maxChars: number; maxTurns: number }): Validated {
  if (!Array.isArray(input) || input.length === 0) return { ok: false, message: 'Send at least one message.' }
  if (input.length > limits.maxTurns * 2) {
    return { ok: false, message: 'This conversation is long. Please start a new one.' }
  }
  const turns: ChatTurn[] = []
  for (const [i, raw] of input.entries()) {
    const turn = raw as { role?: unknown; content?: unknown }
    const expected = i % 2 === 0 ? 'user' : 'assistant'
    if (turn?.role !== expected || typeof turn.content !== 'string') {
      return { ok: false, message: 'The conversation is not in the expected shape.' }
    }
    if (expected === 'user' && turn.content.length > limits.maxChars) {
      return { ok: false, message: `Messages can be up to ${limits.maxChars} characters.` }
    }
    turns.push({ role: expected, content: turn.content.slice(0, expected === 'user' ? limits.maxChars : 8000) })
  }
  if (turns[turns.length - 1].role !== 'user' || !turns[turns.length - 1].content.trim()) {
    return { ok: false, message: 'The last message must be a question.' }
  }
  return { ok: true, turns }
}
