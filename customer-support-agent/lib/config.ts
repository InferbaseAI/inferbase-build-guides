/**
 * Server configuration, read from the environment once per process. Every knob is in .env.example
 * with what it does; nothing here is specific to Inferbase's own deployment.
 */

function int(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw.trim() === '') return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a whole number, got "${raw}"`)
  return value
}

export const config = {
  baseURL: process.env.INFERBASE_BASE_URL || 'https://api.inferbase.ai/v1',
  /** Read lazily so `next build` works without a key; a request without one fails clearly. */
  apiKey(): string {
    const key = process.env.INFERBASE_API_KEY
    if (!key) throw new Error('INFERBASE_API_KEY is not set. Copy .env.example to .env.local and add a key.')
    return key
  },
  /** The key that pays for answers in account mode (signed in, inside your portal). Optional: a
   *  separate key lets that mode have its own daily cap; without one the main key is used. */
  accountApiKey(): string {
    return process.env.INFERBASE_ACCOUNT_API_KEY || this.apiKey()
  },
  /** Where the account tools read from (they call /api/v1/..., not /v1): the API's own origin, unless
   *  INFERBASE_ACCOUNT_API_URL names another (a staging account API beside a production gateway). */
  get apiOrigin(): string {
    return new URL(process.env.INFERBASE_ACCOUNT_API_URL || this.baseURL).origin
  },
  /** Pages allowed to hand this app a signed-in person's read-only token (your portal's origin, for
   *  example https://inferbase.ai). Empty turns account mode off: a token from anywhere else is ignored. */
  accountParentOrigins: (process.env.ACCOUNT_PARENT_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  /** Model calls one answer may make in account mode: each tool round is one, plus the answer. */
  maxToolRounds: int('MAX_TOOL_ROUNDS', 3),
  /** Names this app in your Inferbase usage logs and error tags (X-Inferbase-Source). */
  source: process.env.INFERBASE_SOURCE || 'support-agent',
  chatModel: process.env.CHAT_MODEL || 'auto',
  maxAnswerTokens: int('MAX_ANSWER_TOKENS', 700),
  /** Thinking off by default: an answer from the docs needs no reasoning, and a reasoning model
   *  spends max_tokens on thinking first, so a short budget can end with no answer at all.
   *  `low`, `medium` or `high` turn it on for models that have it. */
  reasoningEffort: (process.env.REASONING_EFFORT || 'none') as 'none' | 'minimal' | 'low' | 'medium' | 'high',
  productName: process.env.PRODUCT_NAME || 'Inferbase',
  /** What the assistant is called in the header and the launcher: "Inferbase Copilot". */
  assistantName: process.env.ASSISTANT_NAME || 'Copilot',
  /** Where your published comparisons with other products live. A question about a product with no
   *  comparison in the index is pointed here; empty says only that there is none. */
  comparisonsUrl: process.env.COMPARISONS_URL ?? 'https://inferbase.ai/compare',
  turnstileSecret: process.env.TURNSTILE_SECRET_KEY || '',
  ratePerMinute: int('RATE_LIMIT_PER_MINUTE', 6),
  ratePerDay: int('RATE_LIMIT_PER_DAY', 60),
  maxMessageChars: int('MAX_MESSAGE_CHARS', 2000),
  maxTurns: int('MAX_TURNS', 20),
  handoff: {
    resendKey: process.env.RESEND_API_KEY || '',
    to: process.env.HANDOFF_TO || '',
    from: process.env.HANDOFF_FROM || '',
    get enabled(): boolean {
      return Boolean(this.resendKey && this.to && this.from)
    },
  },
  retrieval: {
    /** Passages handed to the model per question. */
    topK: int('RETRIEVAL_TOP_K', 6),
  },
}
