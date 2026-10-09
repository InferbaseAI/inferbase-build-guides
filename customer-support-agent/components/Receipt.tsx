'use client'

import { useState } from 'react'
import type { RoutingReceipt, UsageReceipt } from '@/lib/events'
import type { Source } from '@/lib/retrieval'

function money(micros?: number): string | null {
  if (micros === undefined) return null
  const dollars = micros / 1_000_000
  return dollars < 0.01 ? `$${dollars.toFixed(4)}` : `$${dollars.toFixed(3)}`
}

function seconds(ms?: number): string | null {
  return ms === undefined ? null : `${(ms / 1000).toFixed(1)} s`
}

/** Shorten a catalog id for the summary line: "novita/minimax/minimax-m3" -> "minimax-m3". */
function shortModel(model?: string): string | null {
  return model ? (model.split('/').pop() ?? model) : null
}

/**
 * Under each answer: one line saying which model answered, how fast and for how much, and the
 * pages it drew on. "Details" opens the routing decision Inferbase streamed with the answer.
 */
export function Receipt({ sources, routing, usage }: { sources: Source[]; routing?: RoutingReceipt; usage?: UsageReceipt }) {
  const [open, setOpen] = useState(false)
  const summary = [shortModel(routing?.model), seconds(usage?.latency_ms), money(usage?.cost_micros)].filter(Boolean)
  const pages = sources.filter((s, i) => sources.findIndex((x) => x.url === s.url) === i)

  const facts: [string, string][] = []
  if (routing?.model) facts.push(['Model', routing.model])
  if (routing?.task) facts.push(['Task', [routing.task, routing.complexity].filter(Boolean).join(', ')])
  if (routing?.optimize_mode) facts.push(['Objective', routing.optimize_mode])
  if (routing?.forced_single) facts.push(['Choice', 'only one model qualified'])
  else if (typeof routing?.decisiveness === 'number') facts.push(['Margin', `${Math.round(routing.decisiveness * 100)}% over the next model`])
  if (routing?.routing_time_ms !== undefined) facts.push(['Routing time', `${routing.routing_time_ms} ms`])
  if (usage?.ttft_ms !== undefined) facts.push(['First token', seconds(usage.ttft_ms) ?? ''])
  if (usage?.prompt_tokens !== undefined) facts.push(['Tokens', `${usage.prompt_tokens} in, ${usage.completion_tokens ?? 0} out`])

  if (!summary.length && !pages.length) return null
  return (
    <div className="mt-2 text-xs text-muted-foreground">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {summary.length > 0 && <span className="font-mono">{summary.join(' · ')}</span>}
        {facts.length > 0 && (
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="underline-offset-2 hover:text-foreground hover:underline">
            {open ? 'Hide details' : 'How this was answered'}
          </button>
        )}
      </div>
      {pages.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {pages.slice(0, 4).map((s) => (
            <a
              key={s.url}
              href={s.url}
              target="_blank"
              rel="noreferrer"
              className="max-w-full truncate rounded-md border border-border px-2 py-0.5 text-foreground/80 hover:border-primary/40 hover:text-primary"
              title={s.heading}
            >
              {s.title}
            </a>
          ))}
        </div>
      )}
      {open && (
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md border border-border bg-card p-2.5">
          {facts.map(([label, value]) => (
            <div key={label} className="contents">
              <dt>{label}</dt>
              <dd className="break-all font-mono text-foreground">{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}
