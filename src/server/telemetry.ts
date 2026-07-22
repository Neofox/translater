import type { Telemetry, TelemetryOptions } from 'ai'
import { characterCountBucket } from './translationDimensions'
import type { TranslateInputData } from './translateTypes'

export const SAFE_TRANSLATION_CONTEXT_KEYS = {
  intent: true,
  mode: true,
  sourceLanguage: true,
  targetLanguage: true,
  uiLanguage: true,
  hasContext: true,
  refinementCount: true,
  requestKind: true,
  inputLengthBucket: true,
  isPolish: true,
  promptVersion: true,
  requestedModel: true,
  gatewayCacheMode: true,
  trigger: true,
  analyticsSessionId: true,
  clientRunId: true,
  supersedesRunId: true,
  inputRevision: true,
} as const

type LangfuseEnvironment = Partial<
  Pick<
    NodeJS.ProcessEnv,
    | 'LANGFUSE_PUBLIC_KEY'
    | 'LANGFUSE_SECRET_KEY'
    | 'LANGFUSE_BASE_URL'
    | 'LANGFUSE_TRACING_ENVIRONMENT'
    | 'LANGFUSE_RELEASE'
  >
>

export type TranslationRuntimeContext = {
  intent: 'word' | 'sentence'
  mode: 'friends' | 'casual' | 'professional'
  sourceLanguage: string
  targetLanguage: string
  uiLanguage: 'en' | 'ko'
  hasContext: boolean
  refinementCount: number
  requestKind: 'initial' | 'context' | 'refinement'
  inputLengthBucket: ReturnType<typeof characterCountBucket>
  isPolish: boolean
  promptVersion: string
  requestedModel: string
  gatewayCacheMode: 'auto'
  trigger: TranslateInputData['analyticsTrigger']
  analyticsSessionId: string
  clientRunId: string
  supersedesRunId: string
  inputRevision: number
}

export type PreparedTranslationTelemetry = {
  enabled: boolean
  flush: () => Promise<void>
}

type LoadedTelemetry = {
  registerTelemetry: (integration: unknown) => void
  integration: unknown
  start: () => void | Promise<void>
  forceFlush: () => Promise<void>
}

type PrepareTranslationTelemetryOptions = {
  env?: LangfuseEnvironment
  load?: (env: LangfuseEnvironment) => Promise<LoadedTelemetry>
}

const GLOBAL_STATE_KEY = '__neotranslateAiTelemetry'

type TelemetryGlobal = typeof globalThis & {
  [GLOBAL_STATE_KEY]?: Promise<PreparedTranslationTelemetry>
}

const telemetryGlobal = globalThis as TelemetryGlobal
let warned = false

const disabledTelemetry: PreparedTranslationTelemetry = {
  enabled: false,
  async flush() {},
}

function warnOnce(message: string) {
  if (warned) return
  warned = true
  console.warn(`[langfuse] ${message}`)
}

export function isLangfuseConfigured(env: LangfuseEnvironment): boolean {
  return Boolean(
    env.LANGFUSE_PUBLIC_KEY?.trim() && env.LANGFUSE_SECRET_KEY?.trim(),
  )
}

export function translationTelemetryOptions(
  enabled: boolean,
): TelemetryOptions<TranslationRuntimeContext> {
  return {
    isEnabled: enabled,
    recordInputs: false,
    recordOutputs: false,
    functionId: 'translation',
    includeRuntimeContext: SAFE_TRANSLATION_CONTEXT_KEYS,
  }
}

export function translationRuntimeContext(
  data: TranslateInputData,
  model: string,
  promptVersion: string,
): TranslationRuntimeContext {
  const requestKind =
    data.refinements.length > 0
      ? 'refinement'
      : data.context
        ? 'context'
        : 'initial'

  return {
    intent: data.intent,
    mode: data.mode,
    sourceLanguage: data.source,
    targetLanguage: data.target,
    uiLanguage: data.uiLang,
    hasContext: Boolean(data.context),
    refinementCount: data.refinements.length,
    requestKind,
    inputLengthBucket: characterCountBucket(data.text.length),
    isPolish: data.source === data.target,
    promptVersion,
    requestedModel: model,
    gatewayCacheMode: 'auto',
    trigger: data.analyticsTrigger,
    analyticsSessionId: data.analyticsSessionId ?? '',
    clientRunId: data.analyticsRunId ?? '',
    supersedesRunId: data.analyticsSupersedesRunId ?? '',
    inputRevision: data.analyticsInputRevision ?? -1,
  }
}

async function loadNativeTelemetry(
  env: LangfuseEnvironment,
): Promise<LoadedTelemetry> {
  const [ai, langfuse, otel, nodeSdk] = await Promise.all([
    import('ai'),
    import('@langfuse/vercel-ai-sdk'),
    import('@langfuse/otel'),
    import('@opentelemetry/sdk-node'),
  ])

  const processor = new otel.LangfuseSpanProcessor({
    publicKey: env.LANGFUSE_PUBLIC_KEY,
    secretKey: env.LANGFUSE_SECRET_KEY,
    baseUrl: env.LANGFUSE_BASE_URL,
    exportMode: 'immediate',
    mediaUploadEnabled: false,
  })
  const sdk = new nodeSdk.NodeSDK({ spanProcessors: [processor] })
  const integration = new langfuse.LangfuseVercelAiSdkIntegration()

  return {
    registerTelemetry(value) {
      ai.registerTelemetry(value as Telemetry)
    },
    integration,
    start: () => sdk.start(),
    forceFlush: () => processor.forceFlush(),
  }
}

export async function prepareTranslationTelemetry(
  options: PrepareTranslationTelemetryOptions = {},
): Promise<PreparedTranslationTelemetry> {
  const env = options.env ?? process.env
  if (!isLangfuseConfigured(env)) return disabledTelemetry

  telemetryGlobal[GLOBAL_STATE_KEY] ??= (async () => {
    try {
      const loaded = await (options.load ?? loadNativeTelemetry)(env)
      await loaded.start()
      loaded.registerTelemetry(loaded.integration)

      return {
        enabled: true,
        async flush() {
          try {
            await loaded.forceFlush()
          } catch {
            warnOnce('trace flush failed; translations will continue')
          }
        },
      }
    } catch {
      warnOnce('initialization failed; translations will continue untraced')
      return disabledTelemetry
    }
  })()

  return telemetryGlobal[GLOBAL_STATE_KEY]
}

export function resetTranslationTelemetryForTests(): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('Telemetry reset is test-only.')
  }
  delete telemetryGlobal[GLOBAL_STATE_KEY]
  warned = false
}
