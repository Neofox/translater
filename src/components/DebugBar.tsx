import type { Meta } from '../server/translate'

type Props = {
  meta: Meta | null
  cached?: boolean
  sessionCostUsd: number
  sessionCount: number
}

export default function DebugBar({
  meta,
  cached,
  sessionCostUsd,
  sessionCount,
}: Props) {
  const parts: Array<string> = []
  if (meta) {
    parts.push(cached ? 'cache hit' : `${(meta.durationMs / 1000).toFixed(2)}s`)
    parts.push(`${meta.provider}:${meta.model}`)
    parts.push(`${meta.tokens.input}→${meta.tokens.output} tok`)
    if (typeof meta.costUsd === 'number') {
      parts.push(`$${meta.costUsd.toFixed(5)}`)
    }
  }
  parts.push(`session: $${sessionCostUsd.toFixed(5)} · ${sessionCount} req`)
  return <span className="font-mono text-[11px] ">{parts.join('  ·  ')}</span>
}
