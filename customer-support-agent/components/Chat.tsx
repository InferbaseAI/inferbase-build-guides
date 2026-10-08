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
  embedded,
  handoffEnabled,
  turnstileSiteKey,
}: {
  productName: string
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

  return (
    <main className={`mx-auto flex h-dvh max-w-3xl flex-col ${embedded ? 'px-3' : 'px-4 sm:px-6'}`}>
      <header className={`flex items-center justify-between border-b border-border ${embedded ? 'py-2' : 'py-4'}`}>
        <div>
          <h1 className={`font-semibold ${embedded ? 'text-sm' : 'text-lg'}`}>{productName} support</h1>
          {!embedded && <p className="text-sm text-muted-foreground">Answers come from the documentation, with sources.</p>}
        </div>
        {handoffEnabled && !handoffOpen && (
          <button type="button" onClick={() => setHandoffOpen(true)} className="rounded-md border border-border px-2.5 py-1 text-xs">
            Contact support
          </button>
        )}
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto py-4 text-sm" aria-live="polite">
        {messages.length === 0 && (
          <div className="space-y-3">
            <p className="text-muted-foreground">Ask a question about {productName}.</p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" onClick={() => ask(s)} disabled={needsCheck} className="rounded-md border border-border px-3 py-1.5 text-left text-xs hover:bg-muted disabled:opacity-60">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} className="ml-auto max-w-[85%] rounded-md bg-primary px-3 py-2 text-primary-foreground">
              <p className="whitespace-pre-wrap">{m.content}</p>
            </div>
          ) : (
            <div key={i} className="max-w-full">
              {m.content ? <Answer text={m.content.replace(HANDOFF_MARKER, '')} sources={m.sources ?? []} /> : m.streaming && <p className="text-muted-foreground">Thinking...</p>}
              {m.error && <p className="text-danger">{m.error}</p>}
              {!m.streaming && !m.error && <Receipt sources={m.sources ?? []} routing={m.routing} usage={m.usage} />}
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
        className="border-t border-border py-3"
      >
        {turnstileSiteKey && messages.length === 0 && <Turnstile siteKey={turnstileSiteKey} onToken={onToken} />}
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void ask(input)
              }
            }}
            rows={1}
            placeholder="Ask a question"
            aria-label="Your question"
            className="max-h-40 flex-1 resize-none rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
          <button type="submit" disabled={busy || !input.trim() || needsCheck} className="rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60">
            Send
          </button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
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
