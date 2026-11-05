// Normalised DOM snapshot for the TS-vs-Go parity harness: one line per
// rendered element with its tag, every attribute (sorted by name, raw values,
// so class strings keep their spaces) and its own text, indented by depth.
//
// Not compared:
// - [hidden], [inert] and closed [popover] subtrees. Go keeps some elements
//   mounted this way where TS unmounts them (go/web/static/css/go.css); open
//   ones are compared like any other element.
// - script, style, template, link, meta and noscript elements, and the
//   inside of <svg> (icon markup is compared by TestPrimitivesMatchReact).
// - A textarea's text: React mirrors the value into its text content, Go
//   sets only the value. The ARIA snapshots compare the value.
// - The attributes in IGNORED, each a difference by design (reasons there).
// - Floating UI's helpers around an open popup: its portal wrapper (the
//   children are compared in its place), focus-guard and marker spans, and
//   the empty span[aria-owns] that places the portalled popup after its
//   trigger in the accessibility tree (Go's settings.js renders the same
//   span; the ARIA snapshots compare its effect).
// ID references (aria-controls, aria-labelledby, …) keep only their presence:
// React generates its ids.
import type { Page } from '@playwright/test'

export async function domSnapshot(page: Page): Promise<string> {
  return page.evaluate(() => {
    const SKIP = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'LINK', 'META', 'NOSCRIPT'])
    const IGNORED = [
      // Go's UI-language hooks (prefs.js relabels in place).
      /^data-t$/,
      /^data-t-attr$/,
      // htmx request wiring.
      /^hx-/,
      // ContextToggle's active class string, swapped in by context.js.
      /^data-active-class$/,
      // Runtime inline styles (Floating UI coordinates, editor auto-grow
      // heights, animation delays) are covered by the screenshots.
      /^style$/,
      // Element ids: React's are generated (useId), Go's are fixed hooks.
      /^id$/,
      // Go's swap-button icon hooks (OutputPanel renders one icon instead).
      /^data-icon$/,
      // Go's per-POS dictionary block variants (WordSourceMeta re-renders
      // for the active tab; dictionary.js shows the active variant).
      /^data-pos$/,
      // React's <ViewTransition> markers (vt-update, vt-name, …); Go's
      // transition uses base.css's view-transition-class instead.
      /^vt-/,
      // Native popover wiring (TS positions with Floating UI portals).
      /^popover$/,
      /^popovertarget$/,
      // Floating UI's bookkeeping: data-floating-ui-inert on everything
      // outside an open popup, data-floating-ui-focusable and data-tabindex
      // on the popup.
      /^data-floating-ui-/,
      /^data-tabindex$/,
    ]
    const IDREFS = new Set([
      'aria-controls',
      'aria-labelledby',
      'aria-describedby',
      'aria-owns',
      'aria-activedescendant',
      'aria-details',
      'aria-errormessage',
      'aria-flowto',
      'for',
    ])
    const lines: string[] = []
    const walk = (el: Element, depth: number) => {
      if (SKIP.has(el.tagName) || el.hasAttribute('hidden') || el.hasAttribute('inert')) return
      if (el.hasAttribute('popover') && !el.matches(':popover-open')) return
      if (el.hasAttribute('data-floating-ui-portal')) {
        for (const child of el.children) walk(child, depth)
        return
      }
      const helper =
        el.tagName === 'SPAN' &&
        !el.hasChildNodes() &&
        !el.hasAttribute('class') &&
        el.getAttributeNames().some((n) => n === 'aria-owns' || n.startsWith('data-floating-ui-'))
      if (helper) return
      const parts = [el.tagName.toLowerCase()]
      for (const name of el.getAttributeNames().sort()) {
        if (IGNORED.some((re) => re.test(name))) continue
        parts.push(IDREFS.has(name) ? `${name}=<ref>` : `${name}=${JSON.stringify(el.getAttribute(name))}`)
      }
      const text = el.tagName === 'TEXTAREA' ? '' : [...el.childNodes]
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent!.replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .join(' ')
      if (text) parts.push(JSON.stringify(text))
      lines.push('  '.repeat(depth) + parts.join(' '))
      if (el.tagName === 'svg') return
      for (const child of el.children) walk(child, depth + 1)
    }
    for (const child of document.body.children) walk(child, 0)
    return lines.join('\n') + '\n'
  })
}
