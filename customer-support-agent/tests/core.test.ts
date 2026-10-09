import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isGuardrailRefusal, readChunk } from '../lib/events'
import { checkLimits, MemoryLimiter } from '../lib/rate-limit'
import { validateTurns } from '../lib/validate'
import { normalize, topK } from '../lib/vector'

describe('readChunk: the Inferbase events on an OpenAI-shaped stream', () => {
  it('reads the routing event, content, usage and errors', () => {
    assert.deepEqual(readChunk({ object: 'routing', model: 'm', task: 'coding' }), { type: 'routing', routing: { model: 'm', task: 'coding' } })
    assert.deepEqual(readChunk({ object: 'chat.completion.chunk', choices: [{ delta: { content: 'Hi' } }] }), { type: 'delta', text: 'Hi' })
    assert.deepEqual(readChunk({ object: 'usage', usage: { cost_micros: 12 } }), { type: 'usage', usage: { cost_micros: 12 } })
    assert.deepEqual(readChunk({ object: 'error', error: { message: 'no' } }), { type: 'error', message: 'no' })
    assert.equal(readChunk({ object: 'chat.completion.chunk', choices: [{ delta: {} }] }), null)
  })
})

describe('validateTurns', () => {
  const limits = { maxChars: 10, maxTurns: 2 }
  it('accepts alternating turns ending with a question', () => {
    assert.equal(validateTurns([{ role: 'user', content: 'hi' }], limits).ok, true)
  })
  it('refuses a system turn, a long message, an assistant last turn and a long conversation', () => {
    assert.equal(validateTurns([{ role: 'system', content: 'x' }], limits).ok, false)
    assert.equal(validateTurns([{ role: 'user', content: 'x'.repeat(11) }], limits).ok, false)
    assert.equal(validateTurns([{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }], limits).ok, false)
    const long = Array.from({ length: 5 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'x' }))
    assert.equal(validateTurns(long, limits).ok, false)
  })
})

describe('checkLimits', () => {
  it('allows up to the per-minute limit, then refuses until the window passes', () => {
    const limiter = new MemoryLimiter()
    const limits = { perMinute: 2, perDay: 100 }
    assert.equal(checkLimits(limiter, 'ip', limits, 0).ok, true)
    assert.equal(checkLimits(limiter, 'ip', limits, 1).ok, true)
    assert.equal(checkLimits(limiter, 'ip', limits, 2).ok, false)
    assert.equal(checkLimits(limiter, 'ip', limits, 60_001).ok, true)
    assert.equal(checkLimits(limiter, 'other', limits, 2).ok, true)
  })
})

describe('topK', () => {
  it('ranks by cosine similarity', () => {
    const vectors = [[1, 0], [0, 1], [1, 1]].map(normalize)
    assert.deepEqual(topK(normalize([1, 0.1]), vectors, 2).map((h) => h.index), [0, 2])
  })
})

describe('isGuardrailRefusal', () => {
  it('is a guardrail refusal only when the API says so', () => {
    assert.equal(isGuardrailRefusal(403, 'The input was refused by the guardrail: it looks like a prompt injection.'), true)
    assert.equal(isGuardrailRefusal(403, "Model 'x' is not in this key's model pool"), false)
    assert.equal(isGuardrailRefusal(500, 'guardrail provider failed'), false)
  })
})
