import type { RoutingReceipt, UsageReceipt } from '@/lib/events'
import type { Source } from '@/lib/retrieval'

function money(micros?: number): string | null {
  if (micros === undefined) return null
  const dollars = micros / 1_000_000
  return dollars < 0.01 ? `$${dollars.toFixed(5)}` : `$${dollars.toFixed(4)}`
}

/** The receipt under an answer: the documents it was given, the model Inferbase chose and why,
 *  and what the answer cost. The routing half is what Inferbase adds to an OpenAI-shaped stream. */
export function Receipt({ sources, routing, usage }: { sources: Source[]; routing?: RoutingReceipt; usage?: UsageReceipt }) {
  const facts: [string, string][] = []
  if (routing?.model) facts.push(['Model', routing.model])
  if (routing?.task) facts.push(['Task', [routing.task, routing.complexity].filter(Boolean).join(', ')])
  if (routing?.optimize_mode) facts.push(['Objective', routing.optimize_mode])
  if (routing?.forced_single) facts.push(['Choice', 'only one model qualified'])
  else if (typeof routing?.decisiveness === 'number') facts.push(['Margin', `${Math.round(routing.decisiveness * 100)}% over the next model`])
  if (routing?.routing_time_ms !== undefined) facts.push(['Routing', `${routing.routing_time_ms} ms`])
  const cost = money(usage?.cost_micros)
  if (cost) facts.push(['Cost', cost])
  if (usage?.latency_ms !== undefined) facts.push(['Time', `${(usage.latency_ms / 1000).toFixed(1)} s`])

  if (!sources.length && !facts.length) return null
  return (
    <details className="mt-2 rounded-md border border-border bg-card text-xs">
      <summary className="cursor-pointer select-none px-3 py-1.5 text-muted-foreground">How this was answered</summary>
      <div className="space-y-3 border-t border-border px-3 py-2">
        {facts.length > 0 && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            {facts.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="font-mono break-all">{value}</dd>
              </div>
            ))}
          </dl>
        )}
        {sources.length > 0 && (
          <ol className="space-y-1">
            {sources.map((s) => (
              <li key={`${s.n}-${s.url}`}>
                <span className="text-muted-foreground">[{s.n}]</span>{' '}
                <a href={s.url} target="_blank" rel="noreferrer" className="text-primary underline-offset-2 hover:underline">
                  {s.heading}
                </a>
              </li>
            ))}
          </ol>
        )}
      </div>
    </details>
  )
}
