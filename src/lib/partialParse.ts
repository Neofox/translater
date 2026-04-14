import { parse as parsePartial, Allow } from 'partial-json'

// Parse as much of a JSON stream as possible, tolerating trailing truncation
// (unclosed strings, arrays, objects). Returns `null` if nothing usable yet.
export function partialParse<T = unknown>(raw: string): Partial<T> | null {
  if (!raw.trim()) return null
  try {
    return parsePartial(raw, Allow.ALL) as Partial<T>
  } catch {
    return null
  }
}
