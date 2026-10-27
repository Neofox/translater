import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { LearningInput } from './learningTypes'

export const learn = createServerFn({ method: 'POST' })
  .validator(LearningInput)
  .handler(async ({ data }) => {
    const { handleLearning } = await import('./learning.server')
    return handleLearning(data, getRequest().signal)
  })
