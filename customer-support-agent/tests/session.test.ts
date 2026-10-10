import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { issueSession, SESSION_TTL_MS, verifySession } from '../lib/session'
import { checkVisitor } from '../lib/turnstile'

const SECRET = 'test-secret'

describe('visitor sessions', () => {
  it('accepts its own session until it expires', () => {
    const token = issueSession(SECRET, 1000)
    assert.equal(verifySession(SECRET, token, 1000), true)
    assert.equal(verifySession(SECRET, token, 1000 + SESSION_TTL_MS - 1), true)
    assert.equal(verifySession(SECRET, token, 1000 + SESSION_TTL_MS), false)
  })

  it('refuses a session signed with another secret, a moved expiry and junk', () => {
    const token = issueSession(SECRET, 1000)
    assert.equal(verifySession('other-secret', token, 1000), false)
    const [, signature] = token.split('.')
    assert.equal(verifySession(SECRET, `${Number.MAX_SAFE_INTEGER}.${signature}`, 1000), false)
    for (const junk of [undefined, null, 42, '', '.', 'abc', `${token}.x`]) assert.equal(verifySession(SECRET, junk, 1000), false)
  })
})

describe('checkVisitor', () => {
  const pass = async () => true
  const fail = async () => false

  it('lets everything through when no secret is configured', async () => {
    assert.deepEqual(await checkVisitor('', {}, 'ip', fail), { ok: true })
  })

  it('passes a valid session without spending the token', async () => {
    let calls = 0
    const counting = async () => (calls++, true)
    const result = await checkVisitor(SECRET, { session: issueSession(SECRET), turnstileToken: 't' }, 'ip', counting)
    assert.deepEqual(result, { ok: true })
    assert.equal(calls, 0)
  })

  it('passes a fresh token and issues a session for what follows', async () => {
    const result = await checkVisitor(SECRET, { turnstileToken: 't' }, 'ip', pass)
    assert.equal(result.ok, true)
    assert.equal(result.ok && verifySession(SECRET, result.session), true)
  })

  it('refuses a request with neither, a forged session or a failed token', async () => {
    assert.deepEqual(await checkVisitor(SECRET, {}, 'ip', fail), { ok: false })
    assert.deepEqual(await checkVisitor(SECRET, { session: issueSession('other') }, 'ip', fail), { ok: false })
    assert.deepEqual(await checkVisitor(SECRET, { turnstileToken: 't' }, 'ip', fail), { ok: false })
  })
})
