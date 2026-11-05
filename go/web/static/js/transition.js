// Result view transition: OutputPanel's <ViewTransition default=
// "result-transition"> around the result, started only for the completion
// or error update (useTranslate's startTransition). Hand-written: a thin
// wrapper over document.startViewTransition; base.css styles the
// result-transition pseudo-elements.

/** Run `update` (a DOM change of `el`) inside a view transition, or directly
 * without support or under reduced motion. The update runs a frame later
 * inside a transition: it must re-check that its run is still current. */
let latest = 0

export function transition(el, update) {
  if (!document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) return update()
  const id = ++latest
  el.style.viewTransitionName = 'result'
  el.style.setProperty('view-transition-class', 'result-transition')
  document
    .startViewTransition(update)
    .finished.catch(() => {})
    .finally(() => {
      // An overlapping newer transition owns the names now.
      if (id !== latest) return
      el.style.removeProperty('view-transition-name')
      el.style.removeProperty('view-transition-class')
    })
}
