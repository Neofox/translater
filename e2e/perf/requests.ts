// Request classification shared by measure.ts and its unit test (measure.ts
// runs on import, so it cannot be imported by a test).

/** A translation request as the page sends it, in both modes: a same-origin
 * POST /translate whose form body carries the source text (`text=`). The
 * free warm-up call (`/warm`) has an empty body; Listen is never pressed. In
 * --live this is the billed count (each text is unique, so the server cache
 * never answers); in --fake it is checked against the fake's own count. */
export function isTranslationRequest(
  method: string,
  url: string,
  origin: string,
  body: string | null,
): boolean {
  if (method !== 'POST' || new URL(url).origin !== origin || !body) return false
  return /(?:^|&)text=/.test(body)
}
