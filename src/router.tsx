import {
  Link,
  createRouter as createTanStackRouter,
} from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'

export function getRouter() {
  const router = createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
    defaultNotFoundComponent: NotFound,
  })

  return router
}

function NotFound() {
  return (
    <main className="flex min-h-[100dvh] flex-col items-center justify-center gap-3 p-6 text-center text-ink">
      <p className="text-sm font-semibold tracking-tight">404</p>
      <p className="text-ink-soft text-sm">This page doesn't exist.</p>
      <Link
        to="/"
        className="text-xs text-accent underline-offset-2 hover:underline"
      >
        Back to translator
      </Link>
    </main>
  )
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
