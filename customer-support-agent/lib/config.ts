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
