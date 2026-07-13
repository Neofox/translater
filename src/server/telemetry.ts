import type { propagateAttributes, startObservation } from '@langfuse/tracing'

export type CharacterCountBucket =
  '0' | '1-24' | '25-100' | '101-500' | '501-2000' | '2001+'

type TranslationDimensions = {
  intent: 'word' | 'sentence'
  mode: 'friends' | 'casual' | 'professional'
  sourceLanguage: string
  targetLanguage: string
  uiLanguage: 'en' | 'ko'
  hasContext: boolean
  refinementCount: number
  requestKind: 'initial' | 'context' | 'refinement'
  inputLengthBucket: CharacterCountBucket
  isPolish: boolean
  promptVersion: string
  analyticsSessionId?: string
}

type TokenUsage = {
  input: number
  cachedInput: number
  cacheWriteInput: number
  output: number
  total: number
}

type TranslationResult = {
  tokens?: TokenUsage
  costUsd?: number
  resolvedSourceLanguage: string
  resolvedTargetLanguage: string
  outputLengthBucket: CharacterCountBucket
  alternativeCount: number
  hasLearningTips: boolean
}

export type TranslationTelemetry = {
  markFirstToken: () => void
  succeed: (result: TranslationResult) => void
  cancel: () => void
  fail: (error: unknown) => void
  flush: () => Promise<void>
}

type LangfuseRuntime = {
  startObservation: typeof startObservation
  propagateAttributes: typeof propagateAttributes
  forceFlush: () => Promise<void>
}

let runtimePromise: Promise<LangfuseRuntime | undefined> | undefined
let warned = false

const noopTelemetry: TranslationTelemetry = {
  markFirstToken() {},
  succeed(_result) {},
  cancel() {},
  fail() {},
  async flush() {},
}

function warnOnce(message: string, error?: unknown) {
  if (warned) return
  warned = true
  console.warn(`[langfuse] ${message}`, error)
}

function hasCredentials() {
  return Boolean(
    process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY,
  )
}

async function initializeLangfuse(): Promise<LangfuseRuntime | undefined> {
  if (!hasCredentials()) return undefined

  try {
    const [{ NodeTracerProvider }, { LangfuseSpanProcessor }, tracing] =
      await Promise.all([
        import('@opentelemetry/sdk-trace-node'),
        import('@langfuse/otel'),
        import('@langfuse/tracing'),
      ])

    const processor = new LangfuseSpanProcessor({
      publicKey: process.env.LANGFUSE_PUBLIC_KEY,
      secretKey: process.env.LANGFUSE_SECRET_KEY,
      baseUrl: process.env.LANGFUSE_BASE_URL,
      // v5 reads release/environment from LANGFUSE_RELEASE and
      // LANGFUSE_TRACING_ENVIRONMENT rather than trace attributes.
      exportMode: 'immediate',
      mediaUploadEnabled: false,
    })

    const provider = new NodeTracerProvider({
      spanProcessors: [processor],
    })
    provider.register()

    return {
      startObservation: tracing.startObservation,
      propagateAttributes: tracing.propagateAttributes,
      forceFlush: () => processor.forceFlush(),
    }
  } catch (error) {
    warnOnce(
      'initialization failed; translations will continue untraced',
      error,
    )
    return undefined
  }
}

function langfuseRuntime() {
  return (runtimePromise ??= initializeLangfuse())
}

export function langfuseUsageDetails(tokens: TokenUsage) {
  return {
    // Langfuse flat usage buckets must be mutually exclusive. OpenAI's input
    // count includes cache reads and writes, so subtract both from base input.
    input: Math.max(
      0,
      tokens.input - tokens.cachedInput - tokens.cacheWriteInput,
    ),
    cache_read_input_tokens: tokens.cachedInput,
    cache_write_input_tokens: tokens.cacheWriteInput,
    output: tokens.output,
    total: tokens.total,
  }
}

export function characterCountBucket(count: number): CharacterCountBucket {
  if (count === 0) return '0'
  if (count <= 24) return '1-24'
  if (count <= 100) return '25-100'
  if (count <= 500) return '101-500'
  if (count <= 2_000) return '501-2000'
  return '2001+'
}

function safeErrorStatus(error: unknown) {
  if (!error || typeof error !== 'object') return 'Translation request failed'

  const value = error as { name?: unknown; status?: unknown; code?: unknown }
  const name = typeof value.name === 'string' ? value.name : 'Error'
  const status = typeof value.status === 'number' ? ` HTTP ${value.status}` : ''
  const code =
    typeof value.code === 'string' && /^[a-z0-9_.-]+$/i.test(value.code)
      ? ` (${value.code})`
      : ''
  return `${name}${status}${code}`
}

export async function startTranslationTelemetry(
  dimensions: TranslationDimensions,
  cacheLayer: 'local' | 'openai',
  model: string,
): Promise<TranslationTelemetry> {
  const runtime = await langfuseRuntime()
  if (!runtime) return noopTelemetry

  try {
    // Langfuse v5 propagated metadata requires alphanumeric keys and short
    // string values. Content itself stays out of traces by product policy.
    const requestMetadata: Record<string, string> = {
      intent: dimensions.intent,
      mode: dimensions.mode,
      sourceLanguage: dimensions.sourceLanguage,
      targetLanguage: dimensions.targetLanguage,
      uiLanguage: dimensions.uiLanguage,
      hasContext: String(dimensions.hasContext),
      refinementCount: String(dimensions.refinementCount),
      requestKind: dimensions.requestKind,
      inputLengthBucket: dimensions.inputLengthBucket,
      isPolish: String(dimensions.isPolish),
      promptVersion: dimensions.promptVersion,
      cacheLayer,
      providerRequest: String(cacheLayer === 'openai'),
    }
    const safeInput = {
      intent: dimensions.intent,
      mode: dimensions.mode,
      sourceLanguage: dimensions.sourceLanguage,
      targetLanguage: dimensions.targetLanguage,
      requestKind: dimensions.requestKind,
      inputLengthBucket: dimensions.inputLengthBucket,
      hasContext: dimensions.hasContext,
      refinementCount: dimensions.refinementCount,
    }
    const { request, generation } = runtime.propagateAttributes(
      {
        traceName: 'translation',
        version: dimensions.promptVersion,
        metadata: requestMetadata,
        tags: [
          'translation',
          dimensions.intent,
          dimensions.mode,
          dimensions.requestKind,
          cacheLayer,
        ],
        ...(dimensions.analyticsSessionId
          ? { sessionId: dimensions.analyticsSessionId }
          : {}),
      },
      () => {
        const startedRequest = runtime.startObservation('translation.request', {
          input: safeInput,
          version: dimensions.promptVersion,
        })
        const startedGeneration =
          cacheLayer === 'openai'
            ? startedRequest.startObservation(
                'openai.responses',
                {
                  model,
                  input: safeInput,
                  modelParameters: {
                    reasoningEffort: 'none',
                    promptCacheMode: 'explicit',
                    promptCacheTtl: '30m',
                  },
                  version: dimensions.promptVersion,
                },
                { asType: 'generation' },
              )
            : undefined
        return {
          request: startedRequest,
          generation: startedGeneration,
        }
      },
    )

    let ended = false
    let markedFirstToken = false

    const finishError = (error: unknown) => {
      if (ended) return
      ended = true

      try {
        const statusMessage = safeErrorStatus(error)
        const errorMetadata = { outcome: 'error' }
        generation
          ?.update({
            level: 'ERROR',
            statusMessage,
            metadata: errorMetadata,
          })
          .end()
        request
          .update({
            level: 'ERROR',
            statusMessage,
            metadata: errorMetadata,
          })
          .end()
      } catch (telemetryError) {
        warnOnce(
          'trace update failed; translations will continue',
          telemetryError,
        )
      }
    }

    const finishCanceled = () => {
      if (ended) return
      ended = true

      try {
        const canceledMetadata = {
          outcome: 'canceled',
          canceledBeforeFirstToken: String(!markedFirstToken),
        }
        const canceledUpdate = {
          statusMessage: 'Client request canceled',
          metadata: canceledMetadata,
        }
        generation?.update(canceledUpdate).end()
        request.update(canceledUpdate).end()
      } catch (telemetryError) {
        warnOnce(
          'trace cancellation update failed; translations will continue',
          telemetryError,
        )
      }
    }

    const finishSuccess = (result: TranslationResult) => {
      if (ended) return
      ended = true

      try {
        const resultMetadata: Record<string, string> = {
          resolvedSourceLanguage: result.resolvedSourceLanguage,
          resolvedTargetLanguage: result.resolvedTargetLanguage,
          outputLengthBucket: result.outputLengthBucket,
          alternativeCount: String(result.alternativeCount),
          hasLearningTips: String(result.hasLearningTips),
          outcome: 'success',
        }
        const safeOutput = {
          resolvedSourceLanguage: result.resolvedSourceLanguage,
          resolvedTargetLanguage: result.resolvedTargetLanguage,
          outputLengthBucket: result.outputLengthBucket,
          alternativeCount: result.alternativeCount,
          hasLearningTips: result.hasLearningTips,
        }

        generation
          ?.update({
            output: safeOutput,
            metadata: resultMetadata,
            ...(result.tokens
              ? { usageDetails: langfuseUsageDetails(result.tokens) }
              : {}),
            ...(typeof result.costUsd === 'number'
              ? { costDetails: { total: result.costUsd } }
              : {}),
          })
          .end()
        request.update({ output: safeOutput, metadata: resultMetadata }).end()
      } catch (telemetryError) {
        warnOnce(
          'trace update failed; translations will continue',
          telemetryError,
        )
      }
    }

    return {
      markFirstToken() {
        if (!generation || markedFirstToken || ended) return
        markedFirstToken = true
        try {
          generation.update({ completionStartTime: new Date() })
        } catch (error) {
          warnOnce('first-token update failed', error)
        }
      },
      succeed(result) {
        finishSuccess(result)
      },
      cancel() {
        finishCanceled()
      },
      fail(error) {
        finishError(error)
      },
      async flush() {
        try {
          await runtime.forceFlush()
        } catch (error) {
          warnOnce('trace flush failed; translations will continue', error)
        }
      },
    }
  } catch (error) {
    warnOnce(
      'trace creation failed; translations will continue untraced',
      error,
    )
    return noopTelemetry
  }
}
