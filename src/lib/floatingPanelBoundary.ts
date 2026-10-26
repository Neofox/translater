import type { MiddlewareState } from '@floating-ui/react'

// Portaled popups must stay in their panel, including within a fold segment.
export function floatingPanelBoundary({ elements }: MiddlewareState) {
  return {
    padding: 8,
    boundary:
      elements.reference instanceof Element
        ? (elements.reference.closest('section') ?? undefined)
        : undefined,
  }
}
