/**
 * Account tools: what the assistant can look up about the signed-in person's own account.
 *
 * Every tool is one GET to a public Inferbase endpoint, made with the person's READ-ONLY token
 * (minted by the portal for their browser session, passed to this app per request, never stored).
 * That token can read and nothing else, and only what the person can already see in the portal, so
 * a tool cannot see more than its user and cannot change anything. The assistant's own API key pays
 * for the model calls and is never used here: the two credentials never mix.
 *
 * Results are trimmed to the fields an answer needs and capped in size, and they are DATA: they pass
 * the API key's tool-output guardrail before the model reads them, and the prompt says so.
 */
import type OpenAI from 'openai'

type Json = Record<string, unknown>

/** The most a tool result may add to the conversation (characters of JSON). */
export const RESULT_CAP = 8000

/** Thrown when the token is missing, expired or revoked: the browser asks the portal for a new one. */
export class TokenExpired extends Error {
  constructor() {
    super('The account token has expired.')
  }
}

export interface AccountClient {
  get(path: string, query?: Record<string, string | number | undefined>): Promise<unknown>
}

/** A client for the account endpoints, with the person's read-only token as the bearer. */
export function accountClient(apiOrigin: string, token: string, fetcher: typeof fetch = fetch): AccountClient {
  return {
    async get(path, query = {}) {
      const url = new URL(path, apiOrigin)
      for (const [key, value] of Object.entries(query)) if (value !== undefined) url.searchParams.set(key, String(value))
      const response = await fetcher(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } })
      if (response.status === 401) throw new TokenExpired()
      if (!response.ok) return { error: `The account service answered ${response.status}.` }
      return response.json()
    },
  }
}

const usd = (micros: unknown) => (typeof micros === 'number' ? Math.round(micros) / 1e6 : null)
const pick = (record: unknown, keys: string[]): Json => {
  const source = (record ?? {}) as Json
  return Object.fromEntries(keys.filter((k) => source[k] !== undefined && source[k] !== null).map((k) => [k, source[k]]))
}
const _n = (value: unknown) => (typeof value === 'number' ? value : 0)
const list = (value: unknown): Json[] => (Array.isArray(value) ? (value as Json[]) : [])
const clamp = (value: unknown, low: number, high: number, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(high, Math.max(low, Math.round(value))) : fallback
const DAY = /^\d{4}-\d{2}-\d{2}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface Tool {
  /** What the person sees while it runs: "Checked your recent requests". */
  label: string
  definition: OpenAI.Chat.Completions.ChatCompletionFunctionTool
  run(client: AccountClient, args: Json): Promise<unknown>
}

const tool = (name: string, description: string, properties: Json = {}): OpenAI.Chat.Completions.ChatCompletionFunctionTool => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, additionalProperties: false } },
})

export const TOOLS: Record<string, Tool> = {
  recent_requests: {
    label: 'your recent requests',
    definition: tool(
      'recent_requests',
      'API requests on this account, newest first, whatever their age unless filtered: when, which model answered, status and error, latency, tokens, cost, and the guardrail record of a request a guardrail refused. Each has an id that explain_request takes.',
      {
        status: { type: 'string', enum: ['success', 'error'], description: 'Only successful or only failed requests.' },
        hours: { type: 'integer', description: 'Only the last N hours (1 to 720).' },
        date: { type: 'string', description: 'Only one UTC day, as YYYY-MM-DD (for example a day guardrail_activity names).' },
        limit: { type: 'integer', description: 'How many, newest first (1 to 20, default 10).' },
      },
    ),
    async run(client, args) {
      const hours = args.hours === undefined ? undefined : clamp(args.hours, 1, 720, 24)
      const day = typeof args.date === 'string' && DAY.test(args.date) ? args.date : undefined
      const page = (await client.get('/api/v1/inference/usage', {
        limit: clamp(args.limit, 1, 20, 10),
        status: args.status === 'success' || args.status === 'error' ? args.status : undefined,
        start: day ? `${day}T00:00:00Z` : hours ? new Date(Date.now() - hours * 3600_000).toISOString() : undefined,
        end: day ? new Date(Date.parse(`${day}T00:00:00Z`) + 86400_000).toISOString() : undefined,
      })) as Json
      if (page.error) return page
      return {
        total_matching: page.total,
        requests: list(page.items).map((r) => ({
          ...pick(r, ['id', 'created_at', 'status', 'serving_mode', 'was_auto_routed', 'latency_ms', 'ttft_ms', 'total_tokens']),
          model: r.model_display ?? r.model,
          cost_usd: usd(r.cost_micros),
          error: typeof r.error_message === 'string' ? r.error_message.slice(0, 300) : undefined,
          // A refused request's verdicts (door, check, result; never prompt text). A served request's
          // guardrail checks are on its routing decision: explain_request.
          guardrails: r.guardrails ?? undefined,
        })),
      }
    },
  },

  explain_request: {
    label: 'how a request was routed',
    definition: tool(
      'explain_request',
      'Why one request was routed the way it was: the task and complexity it was read as, the routing mode, how many models qualified, which was picked and by what margin, the fallbacks, each routing step in plain words, and the guardrail checks run on it (in policy_rules_applied).',
      { request_id: { type: 'string', description: 'The id from recent_requests.' } },
    ),
    async run(client, args) {
      const id = typeof args.request_id === 'string' ? args.request_id.trim() : ''
      if (!UUID.test(id)) return { error: 'request_id must be the id of a request from recent_requests.' }
      const view = (await client.get(`/api/v1/inference/routing-decisions/by-usage/${id}`)) as Json
      if (view.error) return view
      // What the portal's own request detail states. The steps come as the API's plain sentences
      // (`filter_trail_text`), never the raw records: their codes read backwards as English
      // ("sticky_ineligible" is the conversation's earlier model NOT qualifying).
      const displays = (view.route_displays ?? {}) as Record<string, string>
      const named = (routeId: unknown) => (typeof routeId === 'string' ? (displays[routeId] ?? 'a since-removed model') : null)
      const chain = list(view.chain_attempted) as unknown[]
      return {
        ...pick(view, ['created_at', 'routing_mode', 'preset', 'classifier_task_family', 'classifier_complexity', 'latency_ms', 'ttft_ms', 'cost_usd']),
        models_that_qualified: view.eligibility_pool_size,
        picked: named(view.primary_route_id) ?? named(chain[0]),
        margin_over_runner_up: view.decisiveness,
        margin_basis: view.decisiveness_basis,
        fallbacks_standing_by: chain.slice(1).map(named),
        outcome: typeof view.final_disposition === 'string' ? view.final_disposition.replace(/_/g, ' ') : undefined,
        policy_rules_applied: view.user_rules_applied,
        how_it_was_routed: Array.isArray(view.filter_trail_text)
          ? (view.filter_trail_text as unknown[]).filter((t) => typeof t === 'string').slice(0, 25)
          : // An API from before the sentences: step names and counts, still no codes.
            list(view.filter_trail)
              .slice(0, 25)
              .map((step) => (typeof step.in === 'number' && typeof step.out === 'number' ? `${step.step} ${step.in} -> ${step.out}` : step.step))
              .filter(Boolean),
      }
    },
  },

  usage_summary: {
    label: 'your usage',
    definition: tool(
      'usage_summary',
      'Totals over a window: requests, tokens, cost, errors, latency percentiles, and the top models and API keys by cost.',
      { days: { type: 'integer', description: 'The last N days (1 to 90, default 30).' } },
    ),
    async run(client, args) {
      const days = clamp(args.days, 1, 90, 30)
      const stats = (await client.get('/api/v1/inference/usage/stats', {
        start: new Date(Date.now() - days * 86400_000).toISOString(),
      })) as Json
      if (stats.error) return stats
      const totals = (stats.totals ?? {}) as Json
      return {
        days,
        totals: {
          ...pick(totals, ['requests', 'success_count', 'error_count', 'total_tokens', 'p50_latency_ms', 'p95_latency_ms', 'p50_ttft_ms', 'byok_count']),
          cost_usd: usd(totals.cost_micros),
        },
        top_models: list(stats.by_model)
          .slice(0, 10)
          .map((m) => ({ model: m.model_display ?? m.model, requests: m.requests, cost_usd: usd(m.cost_micros) })),
        top_keys: list(stats.by_key)
          .slice(0, 10)
          .map((k) => ({ ...pick(k, ['name', 'key_prefix', 'requests']), cost_usd: usd(k.cost_micros) })),
      }
    },
  },

  guardrail_activity: {
    label: 'your guardrail activity',
    definition: tool(
      'guardrail_activity',
      'What the guardrail policies did over a window (the Usage page\'s Guardrails panel): requests inspected, skipped and refused; each door\'s safe and unsafe verdicts; the unsafe categories; and the days anything happened. Counts only, never which prompt.',
      { days: { type: 'integer', description: 'The last N days (1 to 365, default 30, as the Usage page).' } },
    ),
    async run(client, args) {
      const days = clamp(args.days, 1, 365, 30)
      const summary = (await client.get('/api/v1/users/account/org/guardrail-usage', { days })) as Json
      if (summary.error) return summary
      return {
        days,
        ...pick(summary, ['inspected', 'skipped', 'refused']),
        by_door: list(summary.by_door),
        unsafe_by_category: list(summary.by_category).map((c) => pick(c, ['name', 'count'])),
        days_with_activity: list(summary.series).filter(
          (d) => _n(d.inspected) + _n(d.unsafe) + _n(d.refused) > 0,
        ),
      }
    },
  },

  api_keys: {
    label: 'your API keys',
    definition: tool(
      'api_keys',
      'The API keys on this account (names and prefixes only, never a secret): active or not, routing policy, project, spend caps and what each has spent today and this month, rate limit, last use, expiry.',
    ),
    async run(client) {
      const keys = await client.get('/api/v1/inference/keys')
      if (!Array.isArray(keys)) return keys
      return (keys as Json[]).map((k) => ({
        ...pick(k, [
          'name',
          'key_prefix',
          'is_active',
          'policy_name',
          'project_name',
          'optimize_mode',
          'spend_cap_daily_usd',
          'spend_cap_monthly_usd',
          'rate_limit_rpm',
          'last_used_at',
          'expires_at',
          'rotation_recommended',
        ]),
        spent_today_usd: usd(k.current_day_spend_micros),
        spent_this_month_usd: usd(k.current_month_spend_micros),
      }))
    },
  },

  connections: {
    label: 'your connections and models',
    definition: tool(
      'connections',
      "Where this account's requests can run: Inferbase's managed models, and each connected provider key or cloud account with its status, how many models it reaches and which, and recent use.",
    ),
    async run(client) {
      const summary = (await client.get('/api/v1/inference/connections/summary')) as Json
      if (summary.error) return summary
      return {
        managed: summary.managed,
        providers: list(summary.providers).map((p) => ({
          ...pick(p, ['provider', 'kind', 'connected', 'status', 'status_detail', 'model_count', 'routed_count', 'requests_7d', 'last_used_at']),
          models: list(p.model_names).slice(0, 20),
        })),
      }
    },
  },

  policies: {
    label: 'your policies',
    definition: tool(
      'policies',
      "The routing policy in effect for this account (objective, model pool, what is enforced) and the guardrail policies it has (what each checks).",
    ),
    async run(client) {
      const [effective, guardrails] = await Promise.all([
        client.get('/api/v1/users/account/org/policies/effective'),
        client.get('/api/v1/users/account/org/guardrail-policies'),
      ])
      return {
        routing: effective,
        guardrails: Array.isArray(guardrails)
          ? (guardrails as Json[]).map((g) => pick(g, ['name', 'slug', 'description', 'is_default', 'enforced', 'spec']))
          : guardrails,
      }
    },
  },
}

export const TOOL_DEFINITIONS = Object.values(TOOLS).map((t) => t.definition)

/** Run one tool call the model asked for. Never throws except TokenExpired: a bad name or bad
 *  arguments come back as an error the model can read and recover from. */
export async function runTool(client: AccountClient, name: string, rawArgs: string): Promise<string> {
  const entry = TOOLS[name]
  if (!entry) return JSON.stringify({ error: `There is no tool named ${name}.` })
  let args: Json = {}
  try {
    args = rawArgs.trim() ? (JSON.parse(rawArgs) as Json) : {}
  } catch {
    return JSON.stringify({ error: 'The tool arguments were not valid JSON.' })
  }
  try {
    return capped(await entry.run(client, args))
  } catch (error) {
    if (error instanceof TokenExpired) throw error
    return JSON.stringify({ error: 'The account service could not be reached.' })
  }
}

export function capped(result: unknown): string {
  const text = JSON.stringify(result)
  return text.length <= RESULT_CAP ? text : `${text.slice(0, RESULT_CAP)}... (truncated)`
}
