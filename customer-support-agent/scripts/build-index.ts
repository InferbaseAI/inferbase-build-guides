/**
 * Build data/index.json from your docs: fetch an llms-full.txt, split it into passages, embed
 * them through Inferbase's /v1/embeddings, and store normalized vectors. Run it whenever the docs
 * change (`npm run index`); a deploy can run it before `next build`.
 *
 * The embedding model is pinned into the index (the model Inferbase reports it used), so questions
 * are embedded by the same model the passages were.
 */
import fs from 'node:fs'
import path from 'node:path'
import { chunkPage, embeddingText, parseLlmsFull } from '../lib/docs'
import { inferbase } from '../lib/inferbase'
import type { DocsIndex, IndexedPassage } from '../lib/retrieval'
import { normalize } from '../lib/vector'

const SOURCE = process.env.DOCS_SOURCE_URL || 'https://inferbase.ai/llms-full.txt'
// Which pages of the file to index, by Source URL; comma-separated. Empty indexes every page.
const PREFIXES = (process.env.DOCS_SOURCE_PREFIX ?? 'https://inferbase.ai/docs,https://inferbase.ai/compare')
  .split(',')
  .map((p) => p.trim())
  .filter(Boolean)
const MODEL = process.env.EMBEDDING_MODEL || 'auto'
const BATCH = 64

async function main() {
  const response = await fetch(SOURCE)
  if (!response.ok) throw new Error(`${SOURCE} answered ${response.status}`)
  const pages = parseLlmsFull(await response.text(), PREFIXES)
  if (pages.length === 0) throw new Error(`No pages under ${PREFIXES.join(', ') || '(any prefix)'} in ${SOURCE}`)
  const passages = pages.flatMap((page) => chunkPage(page))
  console.log(`${pages.length} pages, ${passages.length} passages from ${SOURCE}`)

  const client = inferbase()
  const indexed: IndexedPassage[] = []
  let model = MODEL
  for (let i = 0; i < passages.length; i += BATCH) {
    const batch = passages.slice(i, i + BATCH)
    const result = await client.embeddings.create({ model, input: batch.map(embeddingText) })
    // Pin whatever `auto` resolved to on the first batch, so every passage shares one model.
    model = result.model
    result.data.forEach((item, j) => indexed.push({ ...batch[j], embedding: normalize(item.embedding) }))
    process.stdout.write(`\rembedded ${indexed.length}/${passages.length}`)
  }
  process.stdout.write('\n')

  const index: DocsIndex = { model, builtAt: new Date().toISOString(), source: SOURCE, passages: indexed }
  const out = path.join(process.cwd(), 'data', 'index.json')
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, JSON.stringify(index))
  console.log(`wrote ${out} (${(fs.statSync(out).size / 1e6).toFixed(1)} MB, model ${model})`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
