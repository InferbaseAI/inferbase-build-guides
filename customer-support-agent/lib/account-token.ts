'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Account mode's side of the token handshake with the portal that frames this app.
 *
 *   frame  -> portal   { type: 'inferbase:ready' }          on load, and again when a token is due
 *   portal -> frame    { type: 'inferbase:token', token, expires_at, first_name? }
 *   portal -> frame    { type: 'inferbase:no-token' }       when it cannot mint one
 *
 * The portal mints the token from the person's own signed-in session and posts it to this frame only.
 * Messages are sent to, and accepted from, the configured portal origins only (never '*'), and only
 * from the window that framed us. The token lives in memory for the life of the page.
 */
export const READY = 'inferbase:ready'
export const TOKEN = 'inferbase:token'
export const NO_TOKEN = 'inferbase:no-token'

/** How long the first token may take before the frame shows its docs-only face instead. */
const FIRST_TOKEN_WAIT_MS = 4_000

/** Ask for a new token this long before the current one expires. */
const RENEW_BEFORE_MS = 60_000

interface Held {
  token: string
  expiresAt: number
}

/** The longest first name the greeting shows; anything longer is not a first name. */
const NAME_MAX = 40

export function useAccountToken(parentOrigins: string[]) {
  const [held, setHeld] = useState<Held | null>(null)
  // Who is signed in, for the greeting only ("Hi Vishal"): never sent anywhere.
  const [firstName, setFirstName] = useState('')
  const origins = useRef(parentOrigins)
  const enabled = parentOrigins.length > 0
  // Account mode before the first answer from the portal. The frame shows neither face meanwhile, so
  // a signed-in person never sees the docs-only greeting swap to theirs; a refusal or the wait running
  // out ends it in docs-only mode.
  const [waiting, setWaiting] = useState(enabled)

  const ask = useCallback(() => {
    if (typeof window === 'undefined' || window.parent === window) return
    // One post per allowed origin: the browser delivers only the one whose origin matches the parent.
    for (const origin of origins.current) window.parent.postMessage({ type: READY }, origin)
  }, [])

  useEffect(() => {
    if (!enabled) return
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window.parent || !origins.current.includes(event.origin)) return
      const data = event.data as { type?: unknown; token?: unknown; expires_at?: unknown; first_name?: unknown } | null
      if (data?.type === NO_TOKEN) {
        setWaiting(false)
        return
      }
      if (data?.type !== TOKEN || typeof data.token !== 'string' || typeof data.expires_at !== 'string') return
      const expiresAt = Date.parse(data.expires_at)
      if (Number.isFinite(expiresAt)) setHeld({ token: data.token, expiresAt })
      const name = typeof data.first_name === 'string' ? data.first_name.trim() : ''
      setFirstName(name.length <= NAME_MAX ? name : '')
      setWaiting(false)
    }
    window.addEventListener('message', onMessage)
    ask()
    const giveUp = window.setTimeout(() => setWaiting(false), FIRST_TOKEN_WAIT_MS)
    return () => {
      window.removeEventListener('message', onMessage)
      window.clearTimeout(giveUp)
    }
  }, [enabled, ask])

  // Renew ahead of expiry, so a question never waits on a refresh.
  useEffect(() => {
    if (!held) return
    const timer = window.setTimeout(ask, Math.max(0, held.expiresAt - Date.now() - RENEW_BEFORE_MS))
    return () => window.clearTimeout(timer)
  }, [held, ask])

  /** The API refused the token (signed out, or it lapsed while the tab slept): drop it, ask again. */
  const expired = useCallback(() => {
    setHeld(null)
    ask()
  }, [ask])

  // A token that lapsed anyway (a sleeping tab skips timers) is refused by the API, which ends in
  // `expired` above; nothing here reads the clock during render.
  return { enabled, waiting, token: held?.token ?? null, firstName, expired }
}
