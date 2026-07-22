import type { Intent, Mode } from '../lib/types'

// Bump when the response schema or prompt changes so stale entries miss.
export const CACHE_VERSION = 'v12-ai-gateway'

export type CacheKeyInput = {
  intent: Intent
  mode: Mode
  source: string
  target: string
  uiLang: string
  text: string
  context: string
  refinements: string[]
  previousMain: string
}

export function cacheKeyFor(d: CacheKeyInput, model: string): string {
  // refinements/previousMain are sentence-mode only — word requests must not
  // fragment the cache on fields their prompt never sees.
  const isWord = d.intent === 'word'
  // previousMain only matters when it's anchoring at least one refinement —
  // a stale previousMain sitting alongside an empty refinements list must not
  // fragment the cache (see TranslatorContext.removeRefinement).
  const anchored = !isWord && d.refinements.length > 0
  return JSON.stringify([
    CACHE_VERSION,
    model,
    d.intent,
    d.mode,
    d.source,
    d.target,
    d.uiLang,
    d.text.trim(),
    d.context.trim(),
    isWord ? [] : d.refinements.map((r) => r.trim()),
    anchored ? d.previousMain : '',
  ])
}

// Route requests with an identical stable instructions + few-shot prefix to
// the same provider prompt cache. Live text/context/refinements only occur in
// the final user message and therefore do not belong in this key.
export function promptCacheKeyFor(
  d: Pick<CacheKeyInput, 'intent' | 'mode' | 'source' | 'target' | 'uiLang'>,
): string {
  return [
    'nt',
    CACHE_VERSION,
    d.intent,
    d.uiLang,
    d.source,
    d.target,
    d.mode,
  ].join(':')
}
