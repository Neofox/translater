const MAX = 50

export class LRU<TKey, TValue> {
  private map = new Map<TKey, TValue>()
  constructor(private readonly max = MAX) {}

  get(key: TKey): TValue | undefined {
    const v = this.map.get(key)
    if (v === undefined) return undefined
    this.map.delete(key)
    this.map.set(key, v)
    return v
  }

  set(key: TKey, value: TValue) {
    if (this.map.has(key)) this.map.delete(key)
    this.map.set(key, value)
    if (this.map.size > this.max) {
      const oldest = this.map.keys().next().value
      if (oldest !== undefined) this.map.delete(oldest)
    }
  }
}

export const translationCache = new LRU<string, unknown>()
