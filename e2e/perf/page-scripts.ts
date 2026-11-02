// Functions the harness runs INSIDE the measured page (init scripts and
// page.evaluate bodies). Playwright serializes them, so each one is
// self-contained: no imports, no references to module scope. They read and
// write a few `window.__*` globals declared below.

export type PerfState = {
  fcp: number | null
  lcp: number | null
  cls: number
  longtasks: Array<[number, number]>
}

export type Tracker = {
  /** timeStamp of the first / last `input` event on the source since start. */
  firstKey: number | null
  last: number
  /** performance.now() when main first shows text, Copy enables, Listen
   * enables (the whole result is done). */
  first: number | null
  copy: number | null
  done: number | null
}

export type PageGlobals = {
  __perf: PerfState
  __inputs: number[]
  __tr: Tracker | null
  __trStart: () => void
  __keyboard?: {
    set: (height: number | null, offsetTop: number | null) => void
  }
}

export type Selectors = {
  source: string
  main: string
  copy: string
  listen: string
}

/** Performance observers, installed before any page script so buffered and
 * unbuffered (longtask) entries are all seen. */
export function installPerfObservers(): void {
  const w = window as unknown as PageGlobals
  const perf: PerfState = { fcp: null, lcp: null, cls: 0, longtasks: [] }
  w.__perf = perf
  const types = PerformanceObserver.supportedEntryTypes
  const observe = (
    type: string,
    onEntry: (entry: PerformanceEntry) => void,
  ) => {
    if (!types.includes(type)) return
    new PerformanceObserver((list) =>
      list.getEntries().forEach(onEntry),
    ).observe({ type, buffered: true })
  }
  observe('paint', (e) => {
    if (e.name === 'first-contentful-paint') perf.fcp = e.startTime
  })
  observe('largest-contentful-paint', (e) => {
    perf.lcp = e.startTime
  })
  observe('longtask', (e) => {
    perf.longtasks.push([e.startTime, e.duration])
  })
  observe('layout-shift', (e) => {
    perf.cls += (e as PerformanceEntry & { value: number }).value
  })
}

/** Records every `input` event on the source textarea (from document start,
 * so pre-hydration input counts) and, once `__trStart()` is called, when the
 * translation result reacts. Observes `document`, so it works before
 * `<body>` exists and across server-side swaps. */
export function installInputTracker(s: Selectors): void {
  const w = window as unknown as PageGlobals
  w.__inputs = []
  w.__tr = null
  w.__trStart = () => {
    w.__tr = { firstKey: null, last: 0, first: null, copy: null, done: null }
  }
  document.addEventListener(
    'input',
    (e) => {
      if (!(e.target instanceof Element) || !e.target.matches(s.source)) return
      w.__inputs.push(e.timeStamp)
      const tr = w.__tr
      if (tr) {
        tr.firstKey ??= e.timeStamp
        tr.last = e.timeStamp
      }
    },
    true,
  )
  const enabled = (selector: string) => {
    const el = document.querySelector<HTMLButtonElement>(selector)
    return Boolean(el && !el.disabled)
  }
  const check = () => {
    const tr = w.__tr
    if (!tr || tr.last === 0) return
    const now = performance.now()
    const main = document.querySelector(s.main)?.textContent.trim() ?? ''
    if (tr.first === null && main !== '') tr.first = now
    if (tr.copy === null && enabled(s.copy)) tr.copy = now
    if (tr.done === null && enabled(s.listen)) tr.done = now
  }
  new MutationObserver(check).observe(document, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['disabled'],
  })
}

/** Replaces window.visualViewport with an EventTarget that mirrors the real
 * one until the harness overrides height/offsetTop: the technique of
 * tests/browser/mobile.browser.tsx (stubbed visualViewport, stepped with
 * resize/scroll events) applied to a real page. */
export function installFakeVisualViewport(): void {
  const real = window.visualViewport
  if (!real) return
  const fake = new EventTarget()
  let height: number | null = null
  let offsetTop: number | null = null
  for (const key of [
    'width',
    'offsetLeft',
    'pageLeft',
    'pageTop',
    'scale',
  ] as const)
    Object.defineProperty(fake, key, { get: () => real[key] })
  Object.defineProperty(fake, 'height', { get: () => height ?? real.height })
  Object.defineProperty(fake, 'offsetTop', {
    get: () => offsetTop ?? real.offsetTop,
  })
  real.addEventListener('resize', () => fake.dispatchEvent(new Event('resize')))
  real.addEventListener('scroll', () => fake.dispatchEvent(new Event('scroll')))
  Object.defineProperty(window, 'visualViewport', {
    configurable: true,
    get: () => fake,
  })
  ;(window as unknown as PageGlobals).__keyboard = {
    set(h, top) {
      height = h
      offsetTop = top
      fake.dispatchEvent(new Event('resize'))
      fake.dispatchEvent(new Event('scroll'))
    },
  }
}

export function focusSource(selector: string): boolean {
  const el = document.querySelector<HTMLTextAreaElement>(selector)
  if (!el) return false
  if (document.activeElement !== el) el.focus({ preventScroll: true })
  return document.activeElement === el
}

export function readPerf() {
  const p = (window as unknown as PageGlobals).__perf
  const nav = performance.getEntriesByType('navigation')[0] as
    PerformanceNavigationTiming | undefined
  const types = PerformanceObserver.supportedEntryTypes
  // Lighthouse-style TBT: the part of each long task after FCP beyond 50 ms.
  const fcp = p.fcp
  const tbt =
    fcp === null || !types.includes('longtask')
      ? null
      : p.longtasks.reduce((sum, [begin, duration]) => {
          const from = Math.max(begin, fcp)
          return sum + Math.max(0, begin + duration - from - 50)
        }, 0)
  return {
    ttfb: nav ? nav.responseStart : null,
    docTransferMs: nav ? nav.responseEnd - nav.responseStart : null,
    domContentLoaded: nav ? nav.domContentLoadedEventEnd : null,
    load: nav ? nav.loadEventEnd : null,
    fcp,
    lcp: p.lcp,
    tbt,
    loadCls: types.includes('layout-shift') ? p.cls : null,
  }
}

/** Starts a layout-shift sum (Chromium only) into window.__shift. */
export function startShiftObserver(): boolean {
  const w = window as unknown as {
    __shift: { sum: number; observer: PerformanceObserver | null }
  }
  w.__shift = { sum: 0, observer: null }
  if (!PerformanceObserver.supportedEntryTypes.includes('layout-shift'))
    return false
  const add = (list: PerformanceEntryList) => {
    for (const e of list)
      w.__shift.sum += (e as PerformanceEntry & { value: number }).value
  }
  const observer = new PerformanceObserver((list) => add(list.getEntries()))
  observer.observe({ type: 'layout-shift' })
  w.__shift.observer = observer
  return true
}

export function stopShiftObserver(): number | null {
  const w = window as unknown as {
    __shift: { sum: number; observer: PerformanceObserver | null }
  }
  const observer = w.__shift.observer
  if (!observer) return null
  for (const e of observer.takeRecords())
    w.__shift.sum += (e as PerformanceEntry & { value: number }).value
  observer.disconnect()
  return w.__shift.sum
}

/** Positions of the main text, source textarea and caret, and whether each
 * lies inside the visible band [top, top + height] of the layout viewport
 * (the visual viewport, i.e. above the software keyboard). */
export function layoutSnapshot(arg: {
  main: string
  source: string
  band: { top: number; height: number } | null
}) {
  const band = arg.band ?? {
    top: window.visualViewport?.offsetTop ?? 0,
    height: window.visualViewport?.height ?? window.innerHeight,
  }
  const bottom = band.top + band.height
  const main = document.querySelector(arg.main)?.getBoundingClientRect() ?? null
  const input = document.querySelector<HTMLTextAreaElement>(arg.source)
  const rect = input?.getBoundingClientRect() ?? null
  let caret: { top: number; height: number } | null = null
  if (input && rect) {
    // Mirror-element caret measurement: same box and text metrics, text up
    // to the caret, then a marker span.
    const cs = getComputedStyle(input)
    const div = document.createElement('div')
    const props = [
      'boxSizing',
      'width',
      'paddingTop',
      'paddingRight',
      'paddingBottom',
      'paddingLeft',
      'borderTopWidth',
      'borderRightWidth',
      'borderBottomWidth',
      'borderLeftWidth',
      'borderStyle',
      'fontFamily',
      'fontSize',
      'fontWeight',
      'fontStyle',
      'letterSpacing',
      'lineHeight',
      'textTransform',
      'wordSpacing',
      'textIndent',
      'tabSize',
    ] as const
    for (const p of props) div.style[p] = cs[p]
    div.style.position = 'absolute'
    div.style.visibility = 'hidden'
    div.style.whiteSpace = 'pre-wrap'
    div.style.overflowWrap = 'break-word'
    div.style.top = '0'
    div.style.left = '-9999px'
    div.textContent = input.value.slice(0, input.selectionEnd)
    const span = document.createElement('span')
    span.textContent = '​'
    div.append(span)
    document.body.append(div)
    caret = {
      top: rect.top + span.offsetTop - input.scrollTop,
      height: span.offsetHeight,
    }
    div.remove()
  }
  const lineInside = (top: number, height: number) =>
    top >= band.top - 0.5 && top + height <= bottom + 0.5
  return {
    mainTop: main ? main.top : null,
    sourceTop: rect ? rect.top : null,
    mainVisible: main
      ? lineInside(
          main.top,
          Math.min(
            main.height,
            parseFloat(
              getComputedStyle(document.querySelector(arg.main)!).lineHeight,
            ) || main.height,
          ),
        )
      : null,
    textareaVisible: rect ? rect.top < bottom && rect.bottom > band.top : null,
    caretVisible: caret ? lineInside(caret.top, caret.height) : null,
    sourceFocused: input ? document.activeElement === input : null,
  }
}
