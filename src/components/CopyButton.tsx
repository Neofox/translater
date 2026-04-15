import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import Pill from './ui/Pill'

type Props = {
  text: string
  label?: string
}

export default function CopyButton({ text, label = 'Copy' }: Props) {
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
      {copied ? 'Copied' : label}
    </Pill>
  )
}
