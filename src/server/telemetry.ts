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
  succeed: (result?: TranslationResult) => void
  fail: (error: unknown) => void
}

type LangfuseRuntime = {
  startObservation: typeof startObservation
  propagateAttributes: typeof propagateAttributes
}

let runtimePromise: Promise<LangfuseRuntime | undefined> | undefined
let warned = false

const noopTelemetry: TranslationTelemetry = {
  markFirstToken() {},
  succeed() {},
  fail() {},
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
      environment:
        process.env.LANGFUSE_TRACING_ENVIRONMENT ??
        process.env.VERCEL_ENV ??
        process.env.NODE_ENV,
      release:
        process.env.LANGFUSE_RELEASE ?? process.env.VERCEL_GIT_COMMIT_SHA,
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
    const { analyticsSessionId, ...safeDimensions } = dimensions
    const requestMetadata = {
      ...safeDimensions,
      cacheLayer,
      providerRequest: cacheLayer === 'openai',
    }
    const generationMetadata = {
      intent: dimensions.intent,
      mode: dimensions.mode,
      sourceLanguage: dimensions.sourceLanguage,
      targetLanguage: dimensions.targetLanguage,
      requestKind: dimensions.requestKind,
      inputLengthBucket: dimensions.inputLengthBucket,
      promptVersion: dimensions.promptVersion,
    }
    const { request, generation } = runtime.propagateAttributes(
      {
        traceName: 'translation',
        version: dimensions.promptVersion,
        tags: [
          'translation',
          dimensions.intent,
          dimensions.mode,
          dimensions.requestKind,
          cacheLayer,
        ],
        ...(analyticsSessionId ? { sessionId: analyticsSessionId } : {}),
      },
      () => {
        const startedRequest = runtime.startObservation('translation.request', {
          metadata: requestMetadata,
          version: dimensions.promptVersion,
        })
        const startedGeneration =
          cacheLayer === 'openai'
            ? startedRequest.startObservation(
                'openai.responses',
                {
                  model,
                  metadata: generationMetadata,
                  modelParameters: { reasoningEffort: 'none' },
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

    const finish = (error?: unknown, result?: TranslationResult) => {
      if (ended) return
      ended = true

      try {
        if (error) {
          const statusMessage = safeErrorStatus(error)
          generation
            ?.update({
              level: 'ERROR',
              statusMessage,
              metadata: { ...generationMetadata, outcome: 'error' },
            })
            .end()
          request
            .update({
              level: 'ERROR',
              statusMessage,
              metadata: { ...requestMetadata, outcome: 'error' },
            })
            .end()
          return
        }

        const resultMetadata = result
          ? {
              resolvedSourceLanguage: result.resolvedSourceLanguage,
              resolvedTargetLanguage: result.resolvedTargetLanguage,
              outputLengthBucket: result.outputLengthBucket,
              alternativeCount: result.alternativeCount,
              hasLearningTips: result.hasLearningTips,
              outcome: 'success',
            }
          : { outcome: 'success' }

        if (generation) {
          generation
            .update({
              metadata: { ...generationMetadata, ...resultMetadata },
              ...(result?.tokens
                ? { usageDetails: langfuseUsageDetails(result.tokens) }
                : {}),
              ...(typeof result?.costUsd === 'number'
                ? { costDetails: { total: result.costUsd } }
                : {}),
            })
            .end()
        }
        request
          .update({ metadata: { ...requestMetadata, ...resultMetadata } })
          .end()
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
        finish(undefined, result)
      },
      fail(error) {
        finish(error)
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
