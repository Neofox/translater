// Normalised DOM snapshot for the visual regression suite: one line per
// rendered element with its tag, every attribute (sorted by name, raw values,
// so class strings keep their spaces) and its own text, indented by depth.
//
// Not compared:
// - [hidden], [inert] and closed [popover] subtrees. The app keeps some
//   elements mounted this way (hidden until shown); open ones are
//   compared like any other element.
// - script, style, template, link, meta and noscript elements, and the
//   inside of <svg> (icon markup is covered by internal/web/icons tests).
// - A textarea's text: only its value changes as the user types. The ARIA
//   snapshots compare the value.
// - The attributes in IGNORED: client wiring and runtime values (reasons
//   there).
// - The empty span[aria-owns] settings.js renders to place the Settings
//   popup after its trigger in the accessibility tree (the ARIA snapshots
//   compare its effect).
// ID references (aria-controls, aria-labelledby, …) keep only their presence.
import type { Page } from '@playwright/test'

export async function domSnapshot(page: Page): Promise<string> {
  return page.evaluate(() => {
    const SKIP = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'LINK', 'META', 'NOSCRIPT'])
    const IGNORED = [
      // UI-language hooks (prefs.js relabels in place).
      /^data-t$/,
      /^data-t-attr$/,
      // htmx request wiring.
      /^hx-/,
      // ContextToggle's active class string, swapped in by context.js.
      /^data-active-class$/,
      // Runtime inline styles (popup coordinates, editor auto-grow heights,
      // animation delays) are covered by the screenshots.
      /^style$/,
      // Element ids: fixed script hooks; references keep their presence.
      /^id$/,
      // Swap-button icon hooks (both icons stay mounted, one hidden).
      /^data-icon$/,
      // Per-POS dictionary block variants (dictionary.js shows the active
      // one).
      /^data-pos$/,
      // Native popover wiring (open popups are compared as elements).
      /^popover$/,
      /^popovertarget$/,
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
      const helper =
        el.tagName === 'SPAN' &&
        !el.hasChildNodes() &&
        !el.hasAttribute('class') &&
        el.hasAttribute('aria-owns')
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
