import type { ReactNode } from 'react'
import type { Source } from '@/lib/retrieval'

/**
 * The small slice of markdown support answers use: code fences, bullet and numbered lists,
 * headings, paragraphs; inline code, bold, italic, links and [n] citations. Kept dependency-free
 * and readable; swap in a markdown library if your answers need tables or more.
 */
export function Answer({ text, sources }: { text: string; sources: Source[] }) {
  const parts = text.split(/```[a-zA-Z0-9_-]*\n?/)
  return (
    <div className="space-y-3 leading-relaxed">
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <pre key={i} className="overflow-x-auto rounded-md border border-border bg-muted px-3 py-2.5 font-mono text-xs leading-relaxed">
            {part.trimEnd()}
          </pre>
        ) : (
          <Blocks key={i} text={part} sources={sources} />
        ),
      )}
    </div>
  )
}

function Blocks({ text, sources }: { text: string; sources: Source[] }) {
  const blocks: ReactNode[] = []
  const lines = text.split('\n')
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      i++
      continue
    }
    const heading = /^#{1,6}\s+(.*)$/.exec(line)
    if (heading) {
      blocks.push(
        <p key={i} className="font-semibold">
          {inline(heading[1], sources, `h${i}`)}
        </p>,
      )
      i++
      continue
    }
    const listMatch = /^\s*([-*]|\d+[.)])\s+/.exec(line)
    if (listMatch) {
      const ordered = /\d/.test(listMatch[1])
      const items: string[] = []
      while (i < lines.length && /^\s*([-*]|\d+[.)])\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*]|\d+[.)])\s+/, ''))
        i++
      }
      const List = ordered ? 'ol' : 'ul'
      blocks.push(
        <List key={i} className={`space-y-1 pl-5 ${ordered ? 'list-decimal' : 'list-disc'} marker:text-muted-foreground`}>
          {items.map((item, j) => (
            <li key={j}>{inline(item, sources, `l${i}-${j}`)}</li>
          ))}
        </List>,
      )
      continue
    }
    const paragraph: string[] = []
    while (i < lines.length && lines[i].trim() && !/^\s*([-*]|\d+[.)])\s+/.test(lines[i]) && !/^#{1,6}\s/.test(lines[i])) {
      paragraph.push(lines[i])
      i++
    }
    blocks.push(<p key={i}>{inline(paragraph.join(' '), sources, `p${i}`)}</p>)
  }
  return <>{blocks}</>
}

const INLINE = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\s][^*\n]*\*|\[[^\]\n]+\]\(https?:\/\/[^)\s]+\)|\[\d+\])/

function inline(text: string, sources: Source[], key: string): ReactNode[] {
  return text.split(INLINE).map((piece, i) => {
    const k = `${key}-${i}`
    if (piece.startsWith('`') && piece.endsWith('`') && piece.length > 2) {
      return (
        <code key={k} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
          {piece.slice(1, -1)}
        </code>
      )
    }
    if (piece.startsWith('**') && piece.endsWith('**') && piece.length > 4) return <strong key={k}>{inline(piece.slice(2, -2), sources, k)}</strong>
    if (/^\*[^*]/.test(piece) && piece.endsWith('*') && piece.length > 2) return <em key={k}>{inline(piece.slice(1, -1), sources, k)}</em>
    const link = /^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/.exec(piece)
    if (link) {
      return (
        <a key={k} href={link[2]} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2">
          {link[1]}
        </a>
      )
    }
    const cite = /^\[(\d+)\]$/.exec(piece)
    const source = cite ? sources.find((s) => s.n === Number(cite[1])) : undefined
    if (source) {
      return (
        <a
          key={k}
          href={source.url}
          target="_blank"
          rel="noreferrer"
          title={source.heading}
          className="mx-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded bg-primary/10 px-1 align-text-top text-[10px] font-medium text-primary no-underline hover:bg-primary/20"
        >
          {source.n}
        </a>
      )
    }
    return piece
  })
}
