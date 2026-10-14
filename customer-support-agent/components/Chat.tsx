'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAccountToken } from '@/lib/account-token'
import type { ChatEvent, RoutingReceipt, UsageReceipt } from '@/lib/events'
import { HANDOFF_MARKER } from '@/lib/prompt'
import type { Source } from '@/lib/retrieval'
import type { ChatTurn } from '@/lib/validate'
import { Answer } from './Answer'
import { HandoffForm } from './HandoffForm'
import { Receipt } from './Receipt'
import { Turnstile } from './Turnstile'

interface Message {
  role: 'user' | 'assistant'
  content: string
  sources?: Source[]
  /** Account lookups this answer made ("your recent requests"). */
  lookups?: string[]
  routing?: RoutingReceipt
  usage?: UsageReceipt
  error?: string
  streaming?: boolean
}

// Questions an evaluator asks (price, cost on their own keys, data handling) beside the technical
// ones; each was checked against the docs index for a grounded answer.
const SUGGESTIONS = [
  'How does auto routing choose a model?',
  'What do the plans cost, and is there a free plan?',
  'Do I pay Inferbase extra when I use my own provider keys?',
  'Can I turn on zero data retention?',
  'What does a guardrail policy check?',
]

// Account mode: questions about the person's own account, each answered by one of the account tools.
const ACCOUNT_SUGGESTIONS = [
  'Why did my last failed request fail?',
  'What have I spent in the last 7 days, and on which models?',
  'How was my most recent request routed?',
  'Which models can my connections reach?',
  'What does my routing policy enforce?',
]

export function Chat({
  productName,
  assistantName,
  embedded,
  parentOrigins,
  handoffEnabled,
  turnstileSiteKey,
}: {
  productName: string
  assistantName: string
  embedded: boolean
  /** Account mode when non-empty: the portal origins allowed to hand this frame a read-only token. */
  parentOrigins: string[]
  handoffEnabled: boolean
  turnstileSiteKey: string
}) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  // The bot check. A session (from the chat route) covers every request until it expires; the
  // widget stays mounted so a fresh token is on hand when it does, and is reset once one is spent.
  const [session, setSession] = useState<string | null>(null)
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const [checkKey, setCheckKey] = useState(0)
  const [handoffOpen, setHandoffOpen] = useState(false)
  const bottom = useRef<HTMLDivElement>(null)
  const account = useAccountToken(parentOrigins)
  const signedIn = account.enabled && account.token !== null
  const onToken = useCallback((token: string | null) => setTurnstileToken(token), [])
  const resetCheck = useCallback(() => {
    setTurnstileToken(null)
    setCheckKey((k) => k + 1)
  }, [])
  const onVerifyRequired = useCallback(() => {
    setSession(null)
    resetCheck()
  }, [resetCheck])

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, handoffOpen])

  const turns: ChatTurn[] = messages
    .filter((m) => !m.error && !m.streaming)
    .map((m) => ({ role: m.role, content: m.content }))

  async function ask(question: string) {
    const text = question.trim()
    if (!text || busy) return
    const history: ChatTurn[] = [...turns, { role: 'user', content: text }]
    setMessages((prev) => [...prev.filter((m) => !m.error), { role: 'user', content: text }, { role: 'assistant', content: '', streaming: true }])
    setInput('')
    setBusy(true)
    const update = (patch: (m: Message) => Message) =>
      setMessages((prev) => prev.map((m, i) => (i === prev.length - 1 ? patch(m) : m)))
    let answer = ''

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history, session, turnstileToken, accountToken: account.token ?? undefined }),
      })
      if (!response.ok || !response.body) {
        const body = (await response.json().catch(() => ({}))) as { error?: string; code?: string }
        if (body.code === 'verify') {
          onVerifyRequired()
          setInput(text)
        }
        update((m) => ({ ...m, streaming: false, error: body.error ?? 'Something went wrong. Please try again.' }))
        return
      }
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let newline: number
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline).trim()
          buffer = buffer.slice(newline + 1)
          if (!line) continue
          const event = JSON.parse(line) as ChatEvent
          if (event.type === 'delta') answer += event.text
          if (event.type === 'token_expired') {
            account.expired()
            setInput(text)
          }
          if (event.type === 'session') {
            // The token was spent on this check; the session covers what follows.
            setSession(event.token)
            resetCheck()
          }
          apply(event, update)
        }
      }
    } catch {
      update((m) => ({ ...m, error: 'The connection was lost. Please try again.' }))
    } finally {
      update((m) => ({ ...m, streaming: false, content: m.content.replace(HANDOFF_MARKER, '').trimEnd() }))
      // The model asked for a person (frustration, a human requested, an account question).
      if (answer.includes(HANDOFF_MARKER) && handoffEnabled) setHandoffOpen(true)
      setBusy(false)
    }
  }

  const needsCheck = Boolean(turnstileSiteKey) && !session && !turnstileToken
  const title = `${productName} ${assistantName}`

  function reset() {
    if (busy) return
    setMessages([])
    setHandoffOpen(false)
    setInput('')
  }

  return (
    <main className={`mx-auto flex h-dvh flex-col bg-background ${embedded ? '' : 'max-w-3xl'}`}>
      <header className={`flex items-center gap-3 border-b border-border ${embedded ? 'px-4 py-3' : 'px-4 py-4 sm:px-6'}`}>
        <Mark />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold">{title}</h1>
          <p className="truncate text-xs text-muted-foreground">
            {signedIn ? 'Answers from the documentation and your account' : `Answers from the ${productName} documentation`}
          </p>
        </div>
        {messages.length > 0 && (
          <button type="button" onClick={reset} disabled={busy} className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-muted disabled:opacity-50">
            New chat
          </button>
        )}
        {handoffEnabled && !handoffOpen && (
          <button type="button" onClick={() => setHandoffOpen(true)} className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-muted">
            Contact support
          </button>
        )}
      </header>

      <div className={`flex-1 space-y-5 overflow-y-auto py-5 text-sm ${embedded ? 'px-4' : 'px-4 sm:px-6'}`} aria-live="polite">
        {messages.length === 0 && (
          <div className="space-y-4">
            <div className="flex gap-3">
              <Mark small />
              <div className="space-y-1">
                <p className="font-medium">Hi, I am the {title}.</p>
                <p className="text-muted-foreground">
                  {signedIn
                    ? `Ask me about ${productName} or your own account: requests, errors, spend, keys, connections, policies. I can look things up but cannot change anything.`
                    : `Ask me how ${productName} works: routing, keys, policies, the API. I answer from the documentation and show the pages I used.`}
                </p>
              </div>
            </div>
            <div className="flex flex-col items-start gap-2 pl-10">
              {(signedIn ? ACCOUNT_SUGGESTIONS : SUGGESTIONS).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => ask(s)}
                  disabled={needsCheck}
                  className="rounded-md border border-border px-3 py-1.5 text-left text-xs text-foreground/90 transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary disabled:opacity-60"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} className="flex justify-end">
              <p className="max-w-[85%] whitespace-pre-wrap rounded-lg rounded-br-sm bg-primary px-3 py-2 text-primary-foreground">{m.content}</p>
            </div>
          ) : (
            <div key={i} className="flex gap-3">
              <Mark small />
              <div className="min-w-0 flex-1 pt-0.5">
                {m.lookups && m.lookups.length > 0 && (
                  <p className="mb-1.5 text-xs text-muted-foreground">Checked {m.lookups.join(', ')}</p>
                )}
                {m.content ? <Answer text={m.content.replace(HANDOFF_MARKER, '')} sources={m.sources ?? []} /> : m.streaming && <Typing />}
                {m.error && <p className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-danger">{m.error}</p>}
                {!m.streaming && !m.error && <Receipt sources={m.sources ?? []} routing={m.routing} usage={m.usage} />}
              </div>
            </div>
          ),
        )}
        {handoffOpen && (
          <HandoffForm
            turns={turns}
            proof={{ session, turnstileToken }}
            needsCheck={needsCheck}
            onProofUsed={resetCheck}
            onVerifyRequired={onVerifyRequired}
            onClose={() => setHandoffOpen(false)}
          />
        )}
        <div ref={bottom} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          void ask(input)
        }}
        className={`border-t border-border pb-3 pt-3 ${embedded ? 'px-4' : 'px-4 sm:px-6'}`}
      >
        {turnstileSiteKey && <Turnstile key={checkKey} siteKey={turnstileSiteKey} onToken={onToken} />}
        <div className="flex items-end gap-2 rounded-lg border border-border bg-background p-1.5 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/15">
          <textarea
            value={input}
            onChange={(e) => {
              setInput(e.target.value)
              e.target.style.height = 'auto'
              e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void ask(input)
              }
            }}
            rows={1}
            placeholder={`Ask ${assistantName} a question`}
            aria-label="Your question"
            className="max-h-40 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
          />
          <button
            type="submit"
            disabled={busy || !input.trim() || needsCheck}
            aria-label="Send"
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground transition-opacity disabled:opacity-40"
          >
            <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
        <p className="mt-2 text-center text-[11px] text-muted-foreground">
          Answers are generated and can be wrong. Routed by{' '}
          <a href="https://inferbase.ai" target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
            Inferbase
          </a>
          .
        </p>
      </form>
    </main>
  )
}

/** The assistant's mark: a rounded square, so it reads as the product, not a person. */
function Mark({ small = false }: { small?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary ${small ? 'size-7' : 'size-8'}`}
    >
      <svg viewBox="0 0 16 16" className={small ? 'size-3.5' : 'size-4'} fill="currentColor">
        <path d="M8 1.5 9.6 6.4 14.5 8 9.6 9.6 8 14.5 6.4 9.6 1.5 8 6.4 6.4Z" />
      </svg>
    </span>
  )
}

function Typing() {
  return (
    <span className="inline-flex items-center gap-1 py-2" aria-label="Writing an answer">
      {[0, 150, 300].map((delay) => (
        <span key={delay} className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60" style={{ animationDelay: `${delay}ms` }} />
      ))}
    </span>
  )
}

function apply(event: ChatEvent, update: (patch: (m: Message) => Message) => void) {
  switch (event.type) {
    case 'sources':
      update((m) => ({ ...m, sources: event.sources }))
      break
    case 'routing':
      update((m) => ({ ...m, routing: event.routing }))
      break
    case 'delta':
      update((m) => ({ ...m, content: m.content + event.text }))
      break
    case 'usage':
      update((m) => ({ ...m, usage: { ...m.usage, ...event.usage } }))
      break
    case 'tool':
      update((m) => ({ ...m, lookups: [...new Set([...(m.lookups ?? []), event.label])] }))
      break
    case 'error':
      update((m) => ({ ...m, error: event.message }))
      break
    case 'token_expired':
    case 'session':
    case 'done':
      break
  }
}
