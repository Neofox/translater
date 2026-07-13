import type { Meta } from '../server/translate'

type Props = {
  meta: Meta | null
  cached?: boolean
}

export default function DebugBar({ meta, cached }: Props) {
  if (!meta) return null
  const parts: Array<string> = []
  if (cached) {
    parts.push('cache hit')
  } else {
    parts.push(`${(meta.durationMs / 1000).toFixed(2)}s`)
    if (meta.durationMs > 0 && meta.tokens.output > 0) {
      parts.push(
        `${Math.round(meta.tokens.output / (meta.durationMs / 1000))} tok/s`,
      )
    }
  }
  parts.push(`${meta.tokens.input}→${meta.tokens.output} tok`)
  if (!cached && meta.tokens.cachedInput > 0) {
    const pct = Math.round(
      (meta.tokens.cachedInput / Math.max(1, meta.tokens.input)) * 100,
    )
    parts.push(`cache read ${pct}%`)
  } else if (!cached && meta.tokens.cacheWriteInput > 0) {
    parts.push(`cache write ${meta.tokens.cacheWriteInput}`)
  }
  if (!cached && typeof meta.costUsd === 'number') {
    parts.push(`$${meta.costUsd.toFixed(5)}`)
  }
  return <span className="font-mono text-[11px] ">{parts.join('  ·  ')}</span>
}
