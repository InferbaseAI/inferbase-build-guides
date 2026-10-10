/**
 * Turning an llms-full.txt into passages to search. Pure functions, so they are unit tested.
 *
 * The expected shape (llmstxt.org, as Inferbase and many docs sites publish it): each page starts
 * with a `## Title` line, then a `Source: <url>` line, then its text. Headings inside a page are
 * `###` or deeper. Anything before the first page is the file's preamble and is skipped.
 */

export interface DocPage {
  title: string
  url: string
  text: string
}

export interface Passage {
  id: string
  title: string
  url: string
  /** The page title and section heading, prepended so a passage makes sense on its own. */
  heading: string
  text: string
}

/** Pages whose Source URL starts with one of `urlPrefixes` (all pages when there are none). */
export function parseLlmsFull(raw: string, urlPrefixes: string[] = []): DocPage[] {
  const pages: DocPage[] = []
  const blocks = raw.split(/^## (?!#)/m).slice(1)
  for (const block of blocks) {
    const newline = block.indexOf('\n')
    const title = block.slice(0, newline).trim()
    const rest = block.slice(newline + 1)
    const source = /^Source:\s*(\S+)\s*$/m.exec(rest)
    if (!title || !source) continue
    const url = source[1]
    if (urlPrefixes.length && !urlPrefixes.some((prefix) => url.startsWith(prefix))) continue
    const text = rest.replace(source[0], '').trim()
    if (text) pages.push({ title, url, text })
  }
  return pages
}

/**
 * Split a page at its section headings, then pack paragraphs up to `maxChars`. A section longer
 * than that is split at paragraph boundaries; a single paragraph longer than that stays whole
 * rather than being cut mid-sentence.
 */
/** Sections that are lists of links rather than content: they match many questions and answer none. */
const NAVIGATION_HEADINGS = /^(related|see also|next steps|further reading)$/i

export function chunkPage(page: DocPage, maxChars = 1600): Passage[] {
  const sections: { heading: string; body: string }[] = []
  let heading = ''
  let body: string[] = []
  for (const line of page.text.split('\n')) {
    const match = /^#{3,6}\s+(.*)$/.exec(line)
    if (match) {
      if (body.join('\n').trim()) sections.push({ heading, body: body.join('\n').trim() })
      heading = match[1].trim()
      body = []
    } else {
      body.push(line)
    }
  }
  if (body.join('\n').trim()) sections.push({ heading, body: body.join('\n').trim() })

  const passages: Passage[] = []
  for (const section of sections) {
    if (NAVIGATION_HEADINGS.test(section.heading)) continue
    const label = section.heading ? `${page.title} > ${section.heading}` : page.title
    let current = ''
    const flush = () => {
      if (!current.trim()) return
      passages.push({
        id: `${page.url}#${passages.length}`,
        title: page.title,
        url: page.url,
        heading: label,
        text: current.trim(),
      })
      current = ''
    }
    for (const paragraph of section.body.split(/\n{2,}/)) {
      if (current && current.length + paragraph.length + 2 > maxChars) flush()
      current += (current ? '\n\n' : '') + paragraph
    }
    flush()
  }
  return passages
}

/** What is embedded for a passage: its heading carries the context its text may lack. */
export function embeddingText(passage: Passage): string {
  return `${passage.heading}\n\n${passage.text}`
}
