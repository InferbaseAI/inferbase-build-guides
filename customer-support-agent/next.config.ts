import type { NextConfig } from 'next'

// The page is meant to be framed by your site (public/embed.js). FRAME_ANCESTORS lists the
// origins allowed to frame it; without it, only this app's own origin may.
const frameAncestors = (process.env.FRAME_ANCESTORS ?? '').split(/[\s,]+/).filter(Boolean)

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // The docs index is read from disk at request time; ship it with the chat route.
  outputFileTracingIncludes: { '/api/chat': ['./data/index.json'] },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: `frame-ancestors 'self' ${frameAncestors.join(' ')}`.trim() },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
        ],
      },
    ]
  },
}

export default nextConfig
