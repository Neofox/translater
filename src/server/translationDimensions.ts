export type CharacterCountBucket =
  | '0'
  | '1-24'
  | '25-100'
  | '101-500'
  | '501-2000'
  | '2001+'

export function characterCountBucket(count: number): CharacterCountBucket {
  if (count === 0) return '0'
  if (count <= 24) return '1-24'
  if (count <= 100) return '25-100'
  if (count <= 500) return '101-500'
  if (count <= 2_000) return '501-2000'
  return '2001+'
}
