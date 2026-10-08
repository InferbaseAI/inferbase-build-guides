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
  | { type: 'sources'; sources: Source[] }
  | { type: 'routing'; routing: RoutingReceipt }
  | { type: 'delta'; text: string }
  | { type: 'usage'; usage: UsageReceipt }
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
