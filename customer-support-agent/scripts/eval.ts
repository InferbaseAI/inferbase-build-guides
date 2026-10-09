/**
 * Run the questions in evals/questions.json against your index and, unless --retrieval-only,
 * against the live model. Prints one line per question and a summary; exits 1 below the bar.
 *
 *   npm run eval -- --retrieval-only   # embeddings only: cents, checks the right page is found
 *   npm run eval                       # full answers: checks facts, refusals and handoffs
 *
 * Retrieval passes when an expected page is among the passages the model is given. An answer
 * passes when it contains one of `expect_any` (case-insensitive) and, for a handoff case, the
 * handoff marker. Simple string checks on purpose: they are cheap, deterministic and readable.
 */
import fs from 'node:fs'
import path from 'node:path'
import { APIError } from 'openai'
import { config } from '../lib/config'
import { isGuardrailRefusal } from '../lib/events'
import { inferbase } from '../lib/inferbase'
import { HANDOFF_MARKER, systemPrompt } from '../lib/prompt'
import { retrieve } from '../lib/retrieval'

interface Case {
  question: string
  expect_pages?: string[]
  expect_any?: string[]
  expect_refusal?: boolean
  expect_handoff?: boolean
}

const retrievalOnly = process.argv.includes('--retrieval-only')
const cases = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'evals', 'questions.json'), 'utf8')) as Case[]

async function main() {
  let passed = 0
  let total = 0
  for (const c of cases) {
    let retrieved: Awaited<ReturnType<typeof retrieve>>
    try {
      retrieved = await retrieve(c.question, config.retrieval.topK)
    } catch (error) {
      // The key's guardrail checks the embeddings call too, so an injection attempt is refused at
      // retrieval, before any chat model sees it. For a case that expects a refusal, that passes.
      if (error instanceof APIError && isGuardrailRefusal(error.status, error.message)) {
        total += 1
        const ok = Boolean(c.expect_refusal)
        if (ok) passed += 1
        console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.question}\n      refused by the guardrail: ${error.message}`)
        continue
      }
      throw error
    }
    const { passages, sources } = retrieved
    const found = sources.map((s) => new URL(s.url).pathname)
    const failures: string[] = []
    if (c.expect_pages) {
      total += 1
      if (c.expect_pages.some((p) => found.includes(p))) passed += 1
      else failures.push(`retrieval: none of ${c.expect_pages.join(', ')} in [${[...new Set(found)].join(', ')}]`)
    }
    if (!retrievalOnly && (c.expect_any || c.expect_handoff)) {
      total += 1
      const completion = await inferbase().chat.completions.create({
        model: config.chatModel,
        max_tokens: config.maxAnswerTokens,
        reasoning_effort: config.reasoningEffort,
        messages: [
          { role: 'system', content: systemPrompt(config.productName, passages, sources) },
          { role: 'user', content: c.question },
        ],
      })
      const answer = completion.choices[0]?.message?.content ?? ''
      const hasFact = !c.expect_any || c.expect_any.some((s) => answer.toLowerCase().includes(s.toLowerCase()))
      const hasHandoff = !c.expect_handoff || answer.includes(HANDOFF_MARKER)
      if (hasFact && hasHandoff) passed += 1
      else failures.push(`answer: ${!hasFact ? `none of ${JSON.stringify(c.expect_any)}` : 'no handoff marker'} in "${answer.slice(0, 160).replace(/\s+/g, ' ')}"`)
    }
    console.log(`${failures.length ? 'FAIL' : 'PASS'}  ${c.question}${failures.map((f) => `\n      ${f}`).join('')}`)
  }
  const rate = total ? passed / total : 1
  console.log(`\n${passed}/${total} checks passed (${Math.round(rate * 100)}%)`)
  const bar = Number(process.env.EVAL_PASS_BAR ?? 0.85)
  if (rate < bar) process.exit(1)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
