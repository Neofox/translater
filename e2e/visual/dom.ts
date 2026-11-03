// Normalised DOM snapshot for the TS-vs-Go parity harness: one line per
// rendered element with its tag, raw class string (spaces count), data-testid,
// role, lang, aria-* attributes and own text, indented by depth.
//
// Left out, because they are not markup the user can meet:
// - [hidden], [inert] and closed [popover] subtrees (Go keeps some elements
//   mounted this way where TS unmounts them; see go/web/static/css/go.css);
// - script, style, template, link, meta and noscript, and the inside of
//   <svg> (icon markup is compared by TestPrimitivesMatchReact);
// - every other attribute: Go's i18n hooks (data-t, data-t-attr), htmx and
//   runtime state (hx-*, data-active-class, inline style) differ by design.
// ID references (aria-controls, aria-labelledby, …) keep only their presence:
// React generates its ids.
import type { Page } from '@playwright/test'

export async function domSnapshot(page: Page): Promise<string> {
  return page.evaluate(() => {
    const SKIP = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'LINK', 'META', 'NOSCRIPT'])
    const IDREFS = new Set([
      'aria-controls',
      'aria-labelledby',
      'aria-describedby',
      'aria-owns',
      'aria-activedescendant',
      'aria-details',
      'aria-errormessage',
      'aria-flowto',
    ])
    const lines: string[] = []
    const walk = (el: Element, depth: number) => {
      if (SKIP.has(el.tagName) || el.hasAttribute('hidden') || el.hasAttribute('inert')) return
      if (el.hasAttribute('popover') && !el.matches(':popover-open')) return
      const parts = [el.tagName.toLowerCase()]
      const cls = el.getAttribute('class')
      if (cls !== null) parts.push(`class=${JSON.stringify(cls)}`)
      for (const name of ['data-testid', 'role', 'lang']) {
        const value = el.getAttribute(name)
        if (value !== null) parts.push(`${name}=${JSON.stringify(value)}`)
      }
      for (const name of el.getAttributeNames().filter((n) => n.startsWith('aria-')).sort())
        parts.push(IDREFS.has(name) ? `${name}=<ref>` : `${name}=${JSON.stringify(el.getAttribute(name))}`)
      // A textarea's text is its value (ARIA snapshots compare it); React
      // also mirrors the value into its text content, Go does not.
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
