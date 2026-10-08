import fs from 'node:fs'
import path from 'node:path'
import type { Passage } from './docs'
import { inferbase } from './inferbase'
import { normalize, topK } from './vector'

export interface IndexedPassage extends Passage {
  embedding: number[]
}

export interface DocsIndex {
  /** The embedding model that built the index. Queries must use the same one, so it is pinned
   *  here rather than re-resolved: `auto` could pick a different model on another day. */
  model: string
  builtAt: string
  source: string
  passages: IndexedPassage[]
}

export interface Source {
  n: number
  title: string
  heading: string
  url: string
  score: number
}

const INDEX_PATH = path.join(process.cwd(), 'data', 'index.json')
let cached: DocsIndex | null = null

export function loadIndex(): DocsIndex {
  if (cached) return cached
  if (!fs.existsSync(INDEX_PATH)) {
    throw new Error('data/index.json is missing. Run `npm run index` to build it from your docs.')
  }
  cached = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8')) as DocsIndex
  return cached
}

/** The passages most relevant to `question`, numbered for citation as [1], [2], ... */
export async function retrieve(question: string, k: number): Promise<{ passages: IndexedPassage[]; sources: Source[] }> {
  const index = loadIndex()
  const response = await inferbase().embeddings.create({ model: index.model, input: question })
  const query = normalize(response.data[0].embedding)
  const hits = topK(
    query,
    index.passages.map((p) => p.embedding),
    k,
  )
  const passages = hits.map((hit) => index.passages[hit.index])
  // One source per page, in first-hit order, so a page cited twice is listed once.
  const sources: Source[] = []
  hits.forEach((hit, i) => {
    const p = passages[i]
    if (!sources.some((s) => s.url === p.url && s.heading === p.heading)) {
      sources.push({ n: sources.length + 1, title: p.title, heading: p.heading, url: p.url, score: hit.score })
    }
  })
  return { passages, sources }
}
