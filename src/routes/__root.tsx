import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router'
import { Analytics } from '@vercel/analytics/react'

import appCss from '../styles.css?url'
import { UiLangProvider } from '../hooks/useUiLang'
import { getPreferences } from '../server/preferences'
import { preferenceBootstrap } from '../lib/preferences'

export const Route = createRootRoute({
  loader: () => getPreferences(),
  headers: () => ({
    'Cache-Control': 'private, no-store',
    Vary: 'Cookie, Accept-Language',
  }),
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1, viewport-fit=cover',
      },
      { name: 'robots', content: 'noindex, nofollow, noarchive, nosnippet' },
      { name: 'googlebot', content: 'noindex, nofollow' },
      { name: 'color-scheme', content: 'dark' },
      { name: 'theme-color', content: '#171821' },
      { name: 'apple-mobile-web-app-capable', content: 'yes' },
      { name: 'apple-mobile-web-app-title', content: 'Translater' },
      { title: 'Translater' },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
      { rel: 'alternate icon', href: '/favicon.ico' },
    ],
  }),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  const preferences = Route.useLoaderData()
  return (
    <html lang={preferences.preferences.uiLang} className="dark">
      <head>
        <HeadContent />
        <script
          dangerouslySetInnerHTML={{ __html: preferenceBootstrap(preferences) }}
        />
      </head>
      <body className="bg-bg text-ink font-sans antialiased">
        <UiLangProvider initialPreferences={preferences}>
          {children}
        </UiLangProvider>
        <Analytics />
        <Scripts />
      </body>
    </html>
  )
}
