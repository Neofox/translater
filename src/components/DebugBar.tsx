import type { Meta } from '../server/translate'

type Props = {
  meta: Meta | null
  cached?: boolean
}

export default function DebugBar({ meta, cached }: Props) {
  if (!meta) return null
  const parts: Array<string> = []
  parts.push(cached ? 'cache hit' : `${(meta.durationMs / 1000).toFixed(2)}s`)
  parts.push(`${meta.provider}:${meta.model}`)
  parts.push(`${meta.tokens.input}→${meta.tokens.output} tok`)
  if (typeof meta.costUsd === 'number') {
    parts.push(`$${meta.costUsd.toFixed(5)}`)
  }
  return <span className="font-mono text-[11px] ">{parts.join('  ·  ')}</span>
}
