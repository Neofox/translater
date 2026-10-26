/** Page-memory identity of the request settings that produced a result. */
export function translationRequestKey(request: {
  text: string
  source: string
  target: string
  mode: string
  context: string
  refinements: readonly string[]
  uiLang: string
}) {
  return JSON.stringify([
    request.text.trim(),
    request.source,
    request.target,
    request.mode,
    request.context,
    request.refinements,
    request.uiLang,
  ])
}
