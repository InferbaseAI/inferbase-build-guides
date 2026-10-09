'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
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
  routing?: RoutingReceipt
  usage?: UsageReceipt
  error?: string
  streaming?: boolean
}

const SUGGESTIONS = ['How does auto routing choose a model?', 'How do I use my own provider keys?', 'What does a guardrail policy check?']

export function Chat({
  productName,
  assistantName,
  embedded,
  handoffEnabled,
  turnstileSiteKey,
}: {
  productName: string
  assistantName: string
  embedded: boolean
  handoffEnabled: boolean
  turnstileSiteKey: string
}) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const [handoffOpen, setHandoffOpen] = useState(false)
  const bottom = useRef<HTMLDivElement>(null)
  const onToken = useCallback((token: string | null) => setTurnstileToken(token), [])

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
        body: JSON.stringify({ messages: history, turnstileToken }),
      })
      if (!response.ok || !response.body) {
        const body = (await response.json().catch(() => ({}))) as { error?: string }
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

  const needsCheck = Boolean(turnstileSiteKey) && messages.length === 0 && !turnstileToken
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
          <p className="truncate text-xs text-muted-foreground">Answers from the {productName} documentation</p>
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
                  Ask me how {productName} works: routing, keys, policies, the API. I answer from the documentation and show the pages I used.
                </p>
              </div>
            </div>
            <div className="flex flex-col items-start gap-2 pl-10">
              {SUGGESTIONS.map((s) => (
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
                {m.content ? <Answer text={m.content.replace(HANDOFF_MARKER, '')} sources={m.sources ?? []} /> : m.streaming && <Typing />}
                {m.error && <p className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-danger">{m.error}</p>}
                {!m.streaming && !m.error && <Receipt sources={m.sources ?? []} routing={m.routing} usage={m.usage} />}
              </div>
            </div>
          ),
        )}
        {handoffOpen && <HandoffForm turns={turns} turnstileToken={turnstileToken} onClose={() => setHandoffOpen(false)} />}
        <div ref={bottom} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          void ask(input)
        }}
        className={`border-t border-border pb-3 pt-3 ${embedded ? 'px-4' : 'px-4 sm:px-6'}`}
      >
        {turnstileSiteKey && messages.length === 0 && <Turnstile siteKey={turnstileSiteKey} onToken={onToken} />}
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
    case 'error':
      update((m) => ({ ...m, error: event.message }))
      break
    case 'done':
      break
  }
}
