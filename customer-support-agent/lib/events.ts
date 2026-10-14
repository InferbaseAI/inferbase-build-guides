/**
 * What the chat route streams to the browser, one JSON object per line (NDJSON), and how the
 * Inferbase stream is read to produce it.
 *
 * Inferbase streams OpenAI chunks wrapped by its own events: a `routing` object first (which model
 * was chosen and why), then the content chunks, then a `usage` object (cost and latency). The
 * OpenAI SDK passes those events through untouched, typed as ordinary chunks; they are told apart
 * by their `object` field.
 */
import type { Source } from './retrieval'

export interface RoutingReceipt {
  model?: string
  task?: string | null
  complexity?: string | null
  optimize_mode?: string
  decisiveness?: number | null
  decisiveness_basis?: string
  forced_single?: boolean
  routing_time_ms?: number
  measured?: boolean
  reasoning?: unknown
  alternatives?: unknown[]
}

export interface UsageReceipt {
  prompt_tokens?: number
  completion_tokens?: number
  cost_micros?: number
  latency_ms?: number
  ttft_ms?: number
}

export type ChatEvent =
  | { type: 'session'; token: string }
  | { type: 'sources'; sources: Source[] }
  | { type: 'routing'; routing: RoutingReceipt }
  | { type: 'delta'; text: string }
  | { type: 'usage'; usage: UsageReceipt }
  /** Account mode: a lookup the answer is about to use ("your recent requests"). */
  | { type: 'tool'; label: string }
  /** Account mode: the read-only token was refused (expired or signed out); ask the portal again. */
  | { type: 'token_expired' }
  | { type: 'error'; message: string }
  | { type: 'done' }

/** Classify one raw chunk from the SDK stream. */
export function readChunk(chunk: unknown): ChatEvent | null {
  if (!chunk || typeof chunk !== 'object') return null
  const record = chunk as Record<string, unknown>
  switch (record.object) {
    case 'routing': {
      const { object: _object, ...routing } = record
      return { type: 'routing', routing: routing as RoutingReceipt }
    }
    case 'usage': {
      const usage = (record.usage ?? record) as UsageReceipt
      return { type: 'usage', usage }
    }
    case 'error': {
      const error = record.error as { message?: string } | undefined
      return { type: 'error', message: error?.message ?? 'The answer could not be completed.' }
    }
    default: {
      const choices = record.choices as { delta?: { content?: string | null } }[] | undefined
      const text = choices?.[0]?.delta?.content
      if (typeof text === 'string' && text) return { type: 'delta', text }
      // An OpenAI-style final chunk may carry usage too.
      if (record.usage && typeof record.usage === 'object') return { type: 'usage', usage: record.usage as UsageReceipt }
      return null
    }
  }
}

export function encodeEvent(event: ChatEvent): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(event) + '\n')
}

/** A refusal by the API key's guardrail policy (for example a prompt-injection check), told apart
 *  from other 4xx answers by its message, so a configuration error never reads as "rephrase". */
export function isGuardrailRefusal(status: number | undefined, message: string): boolean {
  return (status === 400 || status === 403) && /guardrail/i.test(message)
}

/** One tool call assembled from the streamed fragments the API sends (id and name first, then the
 *  arguments in pieces), keyed by its index in the turn. */
export interface ToolCall {
  id: string
  name: string
  arguments: string
}

export function collectToolCalls(calls: Map<number, ToolCall>, chunk: unknown): void {
  const record = (chunk ?? {}) as Record<string, unknown>
  const choices = record.choices as { delta?: { tool_calls?: unknown } }[] | undefined
  const fragments = choices?.[0]?.delta?.tool_calls
  if (!Array.isArray(fragments)) return
  for (const fragment of fragments as { index?: number; id?: string; function?: { name?: string; arguments?: string } }[]) {
    const index = fragment.index ?? 0
    const call = calls.get(index) ?? { id: '', name: '', arguments: '' }
    if (fragment.id) call.id = fragment.id
    if (fragment.function?.name) call.name += fragment.function.name
    if (fragment.function?.arguments) call.arguments += fragment.function.arguments
    calls.set(index, call)
  }
}

/** Usage over several model calls (one answer in account mode can take a few): summed. */
export function addUsage(total: UsageReceipt | undefined, next: UsageReceipt): UsageReceipt {
  if (!total) return { ...next }
  const sum = (a?: number, b?: number) => (a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0))
  return {
    ...next,
    prompt_tokens: sum(total.prompt_tokens, next.prompt_tokens),
    completion_tokens: sum(total.completion_tokens, next.completion_tokens),
    cost_micros: sum(total.cost_micros, next.cost_micros),
    latency_ms: sum(total.latency_ms, next.latency_ms),
    // The first VISIBLE token comes in the last call, after the earlier ones finished.
    ttft_ms: next.ttft_ms === undefined ? total.ttft_ms : (total.latency_ms ?? 0) + next.ttft_ms,
  }
}
