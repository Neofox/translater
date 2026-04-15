export type Mode = 'friends' | 'casual' | 'professional'
export type Intent = 'word' | 'sentence'

export const MODE_LABEL: Record<Mode, string> = {
  friends: 'Friends',
  casual: 'Casual',
  professional: 'Professional',
}
