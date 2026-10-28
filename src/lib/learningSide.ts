import type { LearningInputData } from '../server/learningTypes'

/** The UI language is the user's fluent language, matching Learning tips. */
export function learningSide(source: string, target: string, uiLang: string) {
  return target === uiLang && source !== uiLang ? 'source' : 'target'
}

export function learningText(data: LearningInputData) {
  return data.side === 'source' ? data.text : data.translation
}

export function learningLanguage(data: LearningInputData) {
  return data.side === 'source' ? data.source : data.target
}

export function counterpartText(data: LearningInputData) {
  return data.side === 'source' ? data.translation : data.text
}
