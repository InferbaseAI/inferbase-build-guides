/**
 * Citations in the one form the answer view links: `[n]`. Some models cite in their own native
 * form instead, gpt-oss as `【1】` or `【1†L1-L4】` (a passage number and a line range), which
 * reached visitors as raw text. Both become `[1]`; a run like `【1†L1】【2†L3】` becomes `[1][2]`.
 */
export function normalizeCitations(text: string): string {
  return text.replace(/【(\d+)(?:†[^】]*)?】/g, '[$1]')
}

/** The passage numbers an answer cites (`[2]`, `[1][3]`, or a model's native form). */
export function citedNumbers(text: string): Set<number> {
  return new Set([...normalizeCitations(text).matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])))
}
