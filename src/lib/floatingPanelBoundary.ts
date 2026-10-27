import type { MiddlewareState } from '@floating-ui/react'

// Only physical segments constrain a popup to its panel. A short composer must
// allow its language menu to extend over the result, inside viewport safe areas.
export function floatingPanelBoundary({ elements }: MiddlewareState) {
  const reference = elements.reference
  if (!(reference instanceof Element)) return { padding: 8 }
  const panel = reference.closest<HTMLElement>('section')
  const layout =
    reference.closest<HTMLElement>('.translator-panels')?.dataset.layout
  const segmented =
    layout === 'book' ||
    layout === 'laptop' ||
    layout === 'split' ||
    layout === 'workspace'
  const style = getComputedStyle(panel ?? reference)
  const inset = (side: string) =>
    parseFloat(style.getPropertyValue(`--safe-area-${side}`)) || 0
  return {
    padding: {
      top: 8 + inset('top'),
      right: 8 + inset('right'),
      bottom: 8 + inset('bottom'),
      left: 8 + inset('left'),
    },
    boundary: segmented ? (panel ?? undefined) : undefined,
  }
}
