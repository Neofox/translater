/**
 * Provider resolution:
 *   - Explicit: set TRANSLATE_PROVIDER=openai|openrouter|lmstudio.
 *   - Default order: OpenAI → OpenRouter → LM Studio (first with a key wins).
 *
 * All three speak the OpenAI Responses API; only baseURL + apiKey + model change.
 */
type Kind = 'openai' | 'openrouter' | 'lmstudio'

function openrouterProvider() {
  return {
    name: 'openrouter' as const,
    model: process.env.TRANSLATE_MODEL ?? 'openai/gpt-5.4-mini',
    apiKey: process.env.OPENROUTER_API_KEY ?? '',
    baseURL: process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1',
    extraHeaders: {
      'HTTP-Referer':
        process.env.OPENROUTER_SITE_URL ?? 'http://localhost:3000',
      'X-Title': 'neotranslate',
    } as Record<string, string>,
  }
}

function openaiProvider() {
  return {
    name: 'openai' as const,
    model: process.env.TRANSLATE_MODEL ?? 'gpt-5.4-mini',
    apiKey: process.env.OPENAI_API_KEY ?? '',
    baseURL: process.env.OPENAI_BASE_URL,
  }
}

function lmstudioProvider() {
  return {
    name: 'lmstudio' as const,
    model: process.env.LM_STUDIO_MODEL ?? 'local-model',
    apiKey: process.env.LM_STUDIO_API_KEY ?? 'lm-studio',
    baseURL: process.env.LM_STUDIO_URL ?? 'http://localhost:1234/v1',
  }
}

function resolveProvider() {
  const explicit = process.env.TRANSLATE_PROVIDER?.toLowerCase() as
    | Kind
    | undefined
  if (explicit === 'openai') return openaiProvider()
  if (explicit === 'openrouter') return openrouterProvider()
  if (explicit === 'lmstudio') return lmstudioProvider()

  if (process.env.OPENAI_API_KEY) return openaiProvider()
  if (process.env.OPENROUTER_API_KEY) return openrouterProvider()
  return lmstudioProvider()
}

export const PROVIDER = resolveProvider()

if (typeof process !== 'undefined') {
  const tag = PROVIDER.apiKey
    ? `${PROVIDER.apiKey.slice(0, 7)}...${PROVIDER.apiKey.slice(-4)}`
    : '(no key)'
  console.log(
    `[neotranslate] provider=${PROVIDER.name} model=${PROVIDER.model} baseURL=${PROVIDER.baseURL ?? '(default)'} key=${tag}`,
  )
}
