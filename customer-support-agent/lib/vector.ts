/** Small, dependency-free vector math: the whole "vector database" a docs-sized corpus needs. */

export function normalize(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, x) => sum + x * x, 0))
  return norm === 0 ? vector.map(() => 0) : vector.map((x) => x / norm)
}

export function dot(a: number[], b: number[]): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i]
  return sum
}

/** Indices of the `k` highest scores, best first. Vectors are normalized, so dot = cosine. */
export function topK(query: number[], vectors: number[][], k: number): { index: number; score: number }[] {
  return vectors
    .map((vector, index) => ({ index, score: dot(query, vector) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
}
