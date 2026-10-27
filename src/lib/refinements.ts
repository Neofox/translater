import type { StringKey } from './i18n'
export const REFINEMENT_CHIPS: Array<{
  id: string
  instruction: string
  labelKey: StringKey
}> = [
  { id: 'softer', instruction: 'make it softer', labelKey: 'refineSofter' },
  {
    id: 'direct',
    instruction: 'make it more direct',
    labelKey: 'refineMoreDirect',
  },
  { id: 'shorter', instruction: 'make it shorter', labelKey: 'refineShorter' },
  {
    id: 'playful',
    instruction: 'make it more playful',
    labelKey: 'refineMorePlayful',
  },
]
