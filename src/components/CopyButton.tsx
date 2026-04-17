import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import Pill from './ui/Pill'
import { useUiLang } from '../hooks/useUiLang'

type Props = {
  text: string
  label?: string
  compact?: boolean
}

export default function CopyButton({ text, label, compact = false }: Props) {
  const { t } = useUiLang()
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      /* ignore */
    }
  }

  const label_ = copied ? t('copied') : (label ?? t('copy'))
  return (
    <Pill tone="neutral" onClick={handleCopy} aria-label={label_}>
      {copied ? <Check size={14} /> : <Copy size={14} />}
      {!compact && <span>{label_}</span>}
    </Pill>
  )
}
