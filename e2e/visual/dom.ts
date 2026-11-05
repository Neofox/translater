// Normalised DOM snapshot for the visual regression suite: one line per
// rendered element with its tag, every attribute (sorted by name; a class
// as its sorted set of tokens) and its own text, indented by depth.
//
// Not compared:
// - [hidden], [inert] and closed [popover] subtrees: the app keeps some
//   elements mounted this way (hidden until shown); open ones are compared
//   like any other element.
// - script, style, template, link, meta and noscript elements, and the
//   inside of <svg> (icon markup is covered by internal/web/icons tests).
// - A textarea's text: only its value changes as the user types. The ARIA
//   snapshots compare the value.
// - style attributes: runtime values (popup coordinates, editor auto-grow
//   heights, animation delays) that the screenshots cover.
// Adjacent text nodes read as one text; elements separate texts.
// Ids and ID references (aria-controls, aria-labelledby, …) keep only their
// presence: learning phrase ids carry the run id.
import type { Page } from '@playwright/test'

export async function domSnapshot(page: Page): Promise<string> {
  return page.evaluate(() => {
    const SKIP = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'LINK', 'META', 'NOSCRIPT'])
    const IDREFS = new Set([
      'id',
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
    const value = (el: Element, name: string) => {
      if (IDREFS.has(name)) return '<ref>'
      const raw = el.getAttribute(name)!
      const v = name === 'class' ? [...new Set(raw.split(/\s+/).filter(Boolean))].sort().join(' ') : raw
      return JSON.stringify(v)
    }
    const ownText = (el: Element) => {
      const texts: string[] = []
      let run = ''
      for (const n of el.childNodes) {
        if (n.nodeType === Node.TEXT_NODE) run += n.textContent!
        else if (n.nodeType === Node.ELEMENT_NODE) {
          texts.push(run)
          run = ''
        }
      }
      texts.push(run)
      return texts
        .map((t) => t.replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .join(' ')
    }
    const lines: string[] = []
    const walk = (el: Element, depth: number) => {
      if (SKIP.has(el.tagName) || el.hasAttribute('hidden') || el.hasAttribute('inert')) return
      if (el.hasAttribute('popover') && !el.matches(':popover-open')) return
      const parts = [el.tagName.toLowerCase()]
      for (const name of el.getAttributeNames().sort()) {
        if (name !== 'style') parts.push(`${name}=${value(el, name)}`)
      }
      const text = el.tagName === 'TEXTAREA' ? '' : ownText(el)
      if (text) parts.push(JSON.stringify(text))
      lines.push('  '.repeat(depth) + parts.join(' '))
      if (el.tagName === 'svg') return
      for (const child of el.children) walk(child, depth + 1)
    }
    for (const child of document.body.children) walk(child, 0)
    return lines.join('\n') + '\n'
  })
}
