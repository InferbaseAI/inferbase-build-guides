import { Chat } from '@/components/Chat'
import { config } from '@/lib/config'

/** Full page by default; `?embed=1` is the compact frame public/embed.js opens on your site, and
 *  `&account=1` is account mode, opened by your portal (ACCOUNT_PARENT_ORIGINS). `&close=1` draws a
 *  close button that asks the page framing it to close the frame (an `inferbase:close` message). */
export default async function Page({ searchParams }: { searchParams: Promise<{ embed?: string; account?: string; close?: string }> }) {
  const { embed, account, close } = await searchParams
  return (
    <Chat
      productName={config.productName}
      assistantName={config.assistantName}
      embedded={embed === '1'}
      closable={embed === '1' && close === '1'}
      parentOrigins={embed === '1' && account === '1' ? config.accountParentOrigins : []}
      handoffEnabled={config.handoff.enabled}
      turnstileSiteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || ''}
    />
  )
}
