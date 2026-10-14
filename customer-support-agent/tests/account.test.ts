import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { accountClient, capped, RESULT_CAP, runTool, TokenExpired, TOOLS, type AccountClient } from '../lib/account-tools'
import { addUsage, collectToolCalls, type ToolCall } from '../lib/events'
import { systemPrompt } from '../lib/prompt'

const reply = (status: number, body: unknown) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch

describe('accountClient: the read-only token, and nothing else, reaches the API', () => {
  it('sends the token as the bearer and builds the query', async () => {
    let seen: { url: string; auth: string | null } | undefined
    const fetcher = (async (url: URL, init: RequestInit) => {
      seen = { url: String(url), auth: new Headers(init.headers).get('Authorization') }
      return new Response('{}')
    }) as unknown as typeof fetch
    await accountClient('https://api.example.com', 'ro-token', fetcher).get('/api/v1/inference/usage', { limit: 5, status: undefined })
    assert.equal(seen?.url, 'https://api.example.com/api/v1/inference/usage?limit=5')
    assert.equal(seen?.auth, 'Bearer ro-token')
  })
  it('turns a 401 into TokenExpired, and any other refusal into a readable error', async () => {
    await assert.rejects(accountClient('https://a', 't', reply(401, {})).get('/x'), TokenExpired)
    assert.deepEqual(await accountClient('https://a', 't', reply(403, {})).get('/x'), { error: 'The account service answered 403.' })
  })
})

describe('runTool', () => {
  const client = (body: unknown): AccountClient => ({ get: async () => body })
  it('answers an unknown tool or bad arguments with an error the model can read', async () => {
    assert.match(await runTool(client({}), 'delete_everything', '{}'), /no tool named/)
    assert.match(await runTool(client({}), 'recent_requests', '{not json'), /not valid JSON/)
  })
  it('lets an expired token through, so the browser can ask for a new one', async () => {
    const expiring: AccountClient = { get: async () => { throw new TokenExpired() } }
    await assert.rejects(runTool(expiring, 'api_keys', ''), TokenExpired)
  })
  it('trims a request to what an answer needs, with cost in dollars', async () => {
    const page = {
      total: 1,
      items: [{ id: 'a', model: 'm', model_display: 'Model M', cost_micros: 1500, status: 'error', error_message: 'x'.repeat(400), user_rating: 1 }],
    }
    const result = JSON.parse(await runTool(client(page), 'recent_requests', '{"limit": 99}'))
    assert.equal(result.requests[0].model, 'Model M')
    assert.equal(result.requests[0].cost_usd, 0.0015)
    assert.equal(result.requests[0].error.length, 300)
    assert.equal(result.requests[0].user_rating, undefined)
  })
  it('refuses a request id that is not a request id, before calling anything', async () => {
    const calls: string[] = []
    const watching: AccountClient = { get: async (path) => (calls.push(path), {}) }
    assert.match(await runTool(watching, 'explain_request', '{"request_id": "../../users/me"}'), /request_id/)
    assert.deepEqual(calls, [])
  })
  it('explains a routing decision in the portal terms, without the raw trail codes', async () => {
    const view = {
      primary_route_id: 'r1',
      chain_attempted: ['r1', 'r2'],
      route_displays: { r1: 'Model One', r2: 'Model Two' },
      final_disposition: 'served_primary',
      filter_trail: [
        { step: 'pool_loaded', in: 9, out: 4 },
        { step: 'session_affinity', outcome: 'sticky_ineligible', reason: 'balanced_quality_tier' },
      ],
    }
    const id = '0b0c1f9e-6b1e-4c43-9d7e-2c9f3f1a8b10'
    const text = await runTool(client(view), 'explain_request', JSON.stringify({ request_id: id }))
    const result = JSON.parse(text)
    assert.equal(result.picked, 'Model One')
    assert.deepEqual(result.fallbacks_standing_by, ['Model Two'])
    assert.equal(result.outcome, 'served primary')
    assert.deepEqual(result.how_it_was_routed, ['pool_loaded 9 -> 4', 'session_affinity'])
    assert.doesNotMatch(text, /sticky_ineligible/)
  })
  it('uses the API sentences for the routing steps when it has them', async () => {
    const view = {
      chain_attempted: [],
      filter_trail: [{ step: 'session_affinity', outcome: 'sticky_ineligible' }],
      filter_trail_text: ["Moved off the conversation's model: it is above your cost ceiling."],
    }
    const id = '0b0c1f9e-6b1e-4c43-9d7e-2c9f3f1a8b10'
    const result = JSON.parse(await runTool(client(view), 'explain_request', JSON.stringify({ request_id: id })))
    assert.deepEqual(result.how_it_was_routed, ["Moved off the conversation's model: it is above your cost ceiling."])
  })
  it('never returns a key secret field, only names and prefixes', async () => {
    const keys = [{ name: 'prod', key_prefix: 'inf_ab', key: 'inf_secret', current_day_spend_micros: 2_000_000 }]
    const [key] = JSON.parse(await runTool(client(keys), 'api_keys', ''))
    assert.deepEqual(key, { name: 'prod', key_prefix: 'inf_ab', spent_today_usd: 2, spent_this_month_usd: null })
  })
  it('caps what a tool adds to the conversation', () => {
    assert.ok(capped({ text: 'x'.repeat(RESULT_CAP * 2) }).length < RESULT_CAP + 20)
  })
  it('every tool is described to the model under its own name', () => {
    for (const [name, tool] of Object.entries(TOOLS)) assert.equal(tool.definition.function.name, name)
  })
})

describe('collectToolCalls: a call streamed in fragments', () => {
  it('joins the name and the argument pieces per index', () => {
    const calls = new Map<number, ToolCall>()
    const chunk = (fragment: unknown) => ({ choices: [{ delta: { tool_calls: [fragment] } }] })
    collectToolCalls(calls, chunk({ index: 0, id: 'c1', function: { name: 'usage_summary', arguments: '{"da' } }))
    collectToolCalls(calls, chunk({ index: 0, function: { arguments: 'ys": 7}' } }))
    collectToolCalls(calls, { choices: [{ delta: { content: 'hi' } }] })
    assert.deepEqual([...calls.values()], [{ id: 'c1', name: 'usage_summary', arguments: '{"days": 7}' }])
  })
})

describe('addUsage: one answer over several model calls', () => {
  it('sums tokens, cost and time; the first visible token comes after the earlier calls', () => {
    const total = addUsage(addUsage(undefined, { cost_micros: 10, latency_ms: 800, ttft_ms: 300 }), {
      cost_micros: 5,
      latency_ms: 1200,
      ttft_ms: 400,
    })
    assert.deepEqual(total, { cost_micros: 15, latency_ms: 2000, ttft_ms: 1200, prompt_tokens: undefined, completion_tokens: undefined })
  })
})

describe('systemPrompt: account mode', () => {
  it('public mode still says it has no account access; account mode uses the tools and cannot change anything', () => {
    const open = systemPrompt('Acme', [], [])
    const signedIn = systemPrompt('Acme', [], [], '', true)
    assert.match(open, /You have no access to anyone's account/)
    assert.doesNotMatch(signedIn, /You have no access to anyone's account/)
    assert.match(signedIn, /call the account tools/)
    assert.match(signedIn, /You cannot change anything/)
  })
})
