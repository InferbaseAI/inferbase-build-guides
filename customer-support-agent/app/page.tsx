import { Chat } from '@/components/Chat'
import { config } from '@/lib/config'

/** Full page by default; `?embed=1` is the compact frame public/embed.js opens on your site. */
export default async function Page({ searchParams }: { searchParams: Promise<{ embed?: string }> }) {
  const { embed } = await searchParams
  return (
    <Chat
      productName={config.productName}
      embedded={embed === '1'}
      handoffEnabled={config.handoff.enabled}
      turnstileSiteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || ''}
    />
  )
}
