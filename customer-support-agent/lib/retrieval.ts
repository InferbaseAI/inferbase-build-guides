import fs from 'node:fs'
import path from 'node:path'
import { config } from './config'
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

/**
 * The text embedded for a question (the model answering still sees the visitor's own words).
 *
 * A visitor says "you": "Who are your competitors?" means the product's competitors, but an
 * embedding has no idea who "you" is, and that question found the catalog's model-comparison
 * pages instead of the comparisons. Naming the product in its place ("Who are Inferbase's
 * competitors?") ranks them first. Measured on 29 questions: 27 -> 29 in the top 6, none worse.
 *
 * Instruction-tuned embedding models also expect a query to carry
 * the task in front of it, while passages are embedded bare: Qwen3-Embedding's model card asks
 * for `Instruct: <task>\nQuery: <question>`, and without it short questions drift toward any
 * passage that shares a word ("Do you train on my data?" found the catalog's "training cutoff"
 * fields instead of the privacy section). Other models get the question as is.
 */
export function queryText(model: string, question: string, productName: string): string {
  const named = question
    .replace(/\byours?\b/gi, `${productName}'s`)
    .replace(/\byou\b/gi, productName)
  if (/qwen3-embedding/i.test(model)) {
    return `Instruct: Given a question about a product, retrieve documentation passages that answer it\nQuery: ${named}`
  }
  return named
}

/** The passages most relevant to `question`, numbered for citation as [1], [2], ... */
export async function retrieve(question: string, k: number): Promise<{ passages: IndexedPassage[]; sources: Source[] }> {
  const index = loadIndex()
  const response = await inferbase().embeddings.create({ model: index.model, input: queryText(index.model, question, config.productName) })
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
