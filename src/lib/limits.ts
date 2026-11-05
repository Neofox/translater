// Shared with the Go app: shared/translation/limits.json.
import limits from '../../shared/translation/limits.json'

export const MAX_INPUT_CHARS = limits.maxInputChars

export const INPUT_WARN_THRESHOLD = Math.floor(
  MAX_INPUT_CHARS * limits.inputWarnFraction,
)

export const MAX_CONTEXT_CHARS = limits.maxContextChars
export const MAX_REFINEMENTS = limits.maxRefinements
export const MAX_REFINEMENT_CHARS = limits.maxRefinementChars
export const MAX_LEARNING_TRANSLATION_CHARS = limits.maxLearningTranslationChars
