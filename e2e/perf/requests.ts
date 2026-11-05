// Request classification shared by measure.ts and its unit test (measure.ts
// runs on import, so it cannot be imported by a test).

/** A translation request as the page sends it, for both apps and both modes:
 * a same-origin POST whose body carries the source text (TS server function
 * JSON `"text"` key, Go `/translate` form field `text=`). The free warm-up
 * calls (TS server function, Go `/warm`) have empty bodies; Listen is never
 * pressed. In --live this is the billed count (each text is unique, so the
 * server cache never answers); in --fake it is checked against the fake's own
 * count. */
export function isTranslationRequest(
  method: string,
  url: string,
  origin: string,
  body: string | null,
): boolean {
  if (method !== 'POST' || new URL(url).origin !== origin || !body) return false
  return /(?:^|&)text=/.test(body) || body.includes('"text"')
}
