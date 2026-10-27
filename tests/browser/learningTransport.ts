import type {
  LearningInputData,
  LearningResult,
} from '../../src/server/learningTypes'

// Fail closed: the browser runner cannot import or invoke the real provider.
export async function learn(_options: {
  data: LearningInputData
  signal?: AbortSignal
}): Promise<LearningResult> {
  throw new Error('Browser fixtures must supply learning data')
}
