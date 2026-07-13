import type { startObservation } from '@langfuse/tracing'

type TranslationDimensions = {
  intent: 'word' | 'sentence'
  mode: 'friends' | 'casual' | 'professional'
  sourceLanguage: string
  targetLanguage: string
  uiLanguage: 'en' | 'ko'
  hasContext: boolean
  refinementCount: number
  isPolish: boolean
  promptVersion: string
}

type TokenUsage = {
  input: number
  cachedInput: number
  cacheWriteInput: number
  output: number
  total: number
}

type TranslationResult = {
  tokens: TokenUsage
  costUsd?: number
}

export type TranslationTelemetry = {
  markFirstToken: () => void
  succeed: (result?: TranslationResult) => void
  fail: (error: unknown) => void
}

type LangfuseRuntime = {
  startObservation: typeof startObservation
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
    const [{ NodeSDK }, { LangfuseSpanProcessor }, tracing] = await Promise.all(
      [
        import('@opentelemetry/sdk-node'),
        import('@langfuse/otel'),
        import('@langfuse/tracing'),
      ],
    )

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

    const sdk = new NodeSDK({
      spanProcessors: [processor],
      // Node's default resource detectors include process command arguments.
      // They are unnecessary for this product telemetry and broaden the data
      // boundary beyond the explicit metadata assembled below.
      autoDetectResources: false,
      resourceDetectors: [],
    })
    sdk.start()

    return { startObservation: tracing.startObservation }
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
    const metadata = {
      ...dimensions,
      cacheLayer,
      providerRequest: cacheLayer === 'openai',
    }
    const request = runtime.startObservation('translation.request', {
      metadata,
    })
    const generation =
      cacheLayer === 'openai'
        ? request.startObservation(
            'openai.responses',
            {
              model,
              metadata: {
                intent: dimensions.intent,
                mode: dimensions.mode,
                sourceLanguage: dimensions.sourceLanguage,
                targetLanguage: dimensions.targetLanguage,
                promptVersion: dimensions.promptVersion,
              },
              modelParameters: { reasoningEffort: 'none' },
            },
            { asType: 'generation' },
          )
        : undefined

    let ended = false
    let markedFirstToken = false

    const finish = (error?: unknown, result?: TranslationResult) => {
      if (ended) return
      ended = true

      try {
        if (error) {
          const statusMessage = safeErrorStatus(error)
          generation?.update({ level: 'ERROR', statusMessage }).end()
          request.update({ level: 'ERROR', statusMessage }).end()
          return
        }

        if (generation && result) {
          generation
            .update({
              usageDetails: langfuseUsageDetails(result.tokens),
              ...(typeof result.costUsd === 'number'
                ? { costDetails: { total: result.costUsd } }
                : {}),
            })
            .end()
        } else {
          generation?.end()
        }
        request.end()
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
