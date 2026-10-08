import type { Config } from 'tailwindcss'

// Colors are CSS variables (app/globals.css), so a fork re-themes by editing one block.
export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: 'hsl(var(--card))',
        muted: 'hsl(var(--muted))',
        'muted-foreground': 'hsl(var(--muted-foreground))',
        border: 'hsl(var(--border))',
        primary: 'hsl(var(--primary))',
        'primary-foreground': 'hsl(var(--primary-foreground))',
        danger: 'hsl(var(--danger))',
      },
      fontFamily: { sans: ['var(--font-sans)', 'system-ui', 'sans-serif'], mono: ['ui-monospace', 'monospace'] },
    },
  },
  plugins: [],
} satisfies Config
