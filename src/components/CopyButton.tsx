import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import Pill from './ui/Pill'
import { useUiLang } from '../hooks/useUiLang'

type Props = {
  text: string
  label?: string
}

export default function CopyButton({ text, label }: Props) {
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

  return (
    <Pill tone="neutral" onClick={handleCopy}>
      {copied ? <Check size={14} /> : <Copy size={14} />}
      {copied ? t('copied') : (label ?? t('copy'))}
    </Pill>
  )
}
