'use client'

import { useState, type FormEvent } from 'react'
import type { ChatTurn } from '@/lib/validate'

/** "Contact support": the visitor's email and an optional note, sent with the conversation. */
export function HandoffForm({
  turns,
  proof,
  needsCheck,
  onProofUsed,
  onVerifyRequired,
  onClose,
}: {
  turns: ChatTurn[]
  /** The bot check's session or fresh token, shared with the chat. */
  proof: { session: string | null; turnstileToken: string | null }
  needsCheck: boolean
  /** A token sent here may have been spent; the chat fetches a fresh one. */
  onProofUsed: () => void
  onVerifyRequired: () => void
  onClose: () => void
}) {
  const [email, setEmail] = useState('')
  const [note, setNote] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setState('sending')
    setError(null)
    const response = await fetch('/api/handoff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, note, messages: turns, ...proof }),
    })
    if (proof.turnstileToken) onProofUsed()
    if (response.ok) {
      setState('sent')
      return
    }
    const body = (await response.json().catch(() => ({}))) as { error?: string; code?: string }
    if (body.code === 'verify') onVerifyRequired()
    setError(body.error ?? 'Your message could not be sent.')
    setState('idle')
  }

  if (state === 'sent') {
    return (
      <div className="rounded-md border border-border bg-card p-3 text-sm">
        Sent. The support team will reply to {email}.{' '}
        <button type="button" onClick={onClose} className="text-primary underline-offset-2 hover:underline">
          Back to the chat
        </button>
      </div>
    )
  }
  return (
    <form onSubmit={submit} className="space-y-2 rounded-md border border-border bg-card p-3 text-sm">
      <p className="font-medium">Contact support</p>
      <p className="text-muted-foreground">We will send this conversation to the team and reply by email.</p>
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@company.com"
        aria-label="Your email"
        className="w-full rounded-md border border-border bg-background px-3 py-2"
      />
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Anything to add (optional)"
        aria-label="Note"
        rows={2}
        className="w-full resize-none rounded-md border border-border bg-background px-3 py-2"
      />
      {error && <p className="text-danger">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={state === 'sending' || needsCheck} className="rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground disabled:opacity-60">
          {state === 'sending' ? 'Sending...' : 'Send to support'}
        </button>
        <button type="button" onClick={onClose} className="rounded-md border border-border px-3 py-1.5">
          Cancel
        </button>
      </div>
    </form>
  )
}
