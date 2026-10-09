import type { ReactNode } from 'react'
import type { Source } from '@/lib/retrieval'

/**
 * A deliberately small renderer: code fences become code blocks, `[n]` becomes a link to source n,
 * and everything else keeps its line breaks. Swap in a markdown library if your answers need more.
 */
export function Answer({ text, sources }: { text: string; sources: Source[] }) {
  const parts = text.split(/```[a-zA-Z0-9_-]*\n?/)
  return (
    <div className="space-y-2">
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <pre key={i} className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed">
            {part.trimEnd()}
          </pre>
        ) : (
          <p key={i} className="whitespace-pre-wrap leading-relaxed">
            {withCitations(part.trim(), sources)}
          </p>
        ),
      )}
    </div>
  )
}

function withCitations(text: string, sources: Source[]): ReactNode[] {
  return text.split(/(\[\d+\])/).map((piece, i) => {
    const match = /^\[(\d+)\]$/.exec(piece)
    const source = match ? sources.find((s) => s.n === Number(match[1])) : undefined
    if (!source) return piece
    return (
      <a
        key={i}
        href={source.url}
        target="_blank"
        rel="noreferrer"
        title={source.heading}
        className="align-super text-[0.7em] text-primary no-underline hover:underline"
      >
        [{source.n}]
      </a>
    )
  })
}
