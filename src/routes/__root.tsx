import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router'
import { Analytics } from '@vercel/analytics/react'

import appCss from '../styles.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1, viewport-fit=cover',
      },
      { name: 'color-scheme', content: 'dark' },
      { name: 'theme-color', content: '#0f1118' },
      { name: 'apple-mobile-web-app-capable', content: 'yes' },
      { name: 'apple-mobile-web-app-title', content: 'translater' },
      { title: 'translater' },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <HeadContent />
      </head>
      <body className="bg-bg text-ink font-sans antialiased">
        {children}
        <Analytics />
        <Scripts />
      </body>
    </html>
  )
}
