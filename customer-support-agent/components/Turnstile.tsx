'use client'

import { useEffect, useRef } from 'react'

interface TurnstileApi {
  render: (el: HTMLElement, options: { sitekey: string; callback: (token: string) => void; 'expired-callback': () => void; appearance?: string }) => string
  remove: (id: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

/** Cloudflare Turnstile, shown only until it passes ("interaction-only" appearance). */
export function Turnstile({ siteKey, onToken }: { siteKey: string; onToken: (token: string | null) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let widget: string | null = null
    let cancelled = false
    const mount = () => {
      if (cancelled || !ref.current || !window.turnstile) return
      widget = window.turnstile.render(ref.current, {
        sitekey: siteKey,
        appearance: 'interaction-only',
        callback: (token) => onToken(token),
        'expired-callback': () => onToken(null),
      })
    }
    if (window.turnstile) mount()
    else {
      const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT}"]`)
      const script = existing ?? Object.assign(document.createElement('script'), { src: SCRIPT, async: true })
      script.addEventListener('load', mount)
      if (!existing) document.head.appendChild(script)
    }
    return () => {
      cancelled = true
      if (widget && window.turnstile) window.turnstile.remove(widget)
    }
  }, [siteKey, onToken])
  return <div ref={ref} />
}
