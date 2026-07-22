# Vercel AI Gateway Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the direct OpenAI Responses integration with Vercel AI SDK v7 routed exclusively through Vercel AI Gateway, while preserving strict structured streaming, cancellation, local caching, and content-free telemetry.

**Architecture:** Keep `translate.ts` as the server-side orchestrator and the existing `{ type: 'delta', raw }` browser protocol. Add a small Gateway adapter for model/configuration/provider options, a pure error classifier, and a pure structured-stream consumer so the risky provider boundary can be unit-tested without paid requests. Replace manual Langfuse spans with AI SDK v7 telemetry registered through Langfuse's official integration; deployment still selects one exact `provider/model` with no UI selector, provider bypass, retry, or fallback-model list.

**Tech Stack:** TypeScript 6, TanStack Start server functions, Vercel AI SDK v7 (`ai`), AI Gateway, Zod 4, Vitest 4, `@langfuse/vercel-ai-sdk` 5.9+, Langfuse v5, OpenTelemetry Node SDK, pnpm, Node.js 22+ with ESM.

## Global Constraints

- Follow the approved design in `docs/superpowers/specs/2026-07-22-vercel-ai-gateway-migration-design.md`.
- Prefix every shell command with `rtk`, per the repository instructions.
- Use `apply_patch` for source and documentation edits.
- Preserve the client wire contract: raw JSON text deltas followed by one validated terminal object.
- Never send a fallback model list through `providerOptions.gateway.models`.
- Set `maxRetries: 0`; a request is paid and retried only after an explicit user action.
- Use AI SDK v7's top-level `instructions` option for system instructions; keep system-role messages out of `messages` and do not enable `allowSystemInMessages`.
- Keep source text, prompt text, context, refinements, raw output, parsed output, provider response bodies, and provider metadata out of Langfuse.
- Enable AI SDK telemetry with `recordInputs: false`, `recordOutputs: false`, and an explicit safe runtime-context allowlist.
- Keep AI SDK request/response body capture and the integration's supplemental provider metadata, headers, schema, and blanket runtime-context export disabled.
- Do not create manual Langfuse request/generation spans or application-side cost records alongside native telemetry.
- Keep `AI_GATEWAY_API_KEY` server-only. Never add a real key to a file or command.
- Commit only files named in the current task. Do not include unrelated worktree changes.
- Run the focused failing test before implementation and the same focused test after implementation for every behavior-changing task.

---

### Task 1: Establish the dependency baseline and install AI SDK v7

**Files:**

- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Record a clean baseline**

Run:

```bash
rtk git status --short
rtk env CI=true pnpm test
rtk npx tsc --noEmit
```

Expected: the existing suite and typecheck pass. If they do not, stop and record the pre-existing failure before changing dependencies.

- [ ] **Step 2: Confirm v7 runtime prerequisites and add AI SDK v7**

Run:

```bash
rtk node --version
rtk node -e "const p=require('./package.json'); if (p.type !== 'module') throw new Error('package must be ESM'); console.log('ESM verified')"
rtk rg -n "nodejs22\.x" vite.config.ts
rtk env CI=true pnpm add ai@^7 @langfuse/vercel-ai-sdk@^5.9.1 @opentelemetry/sdk-node@^0.221.0
```

Expected: Node is at least v22, the project reports `ESM verified`, Vercel uses `nodejs22.x`, and `package.json` contains AI SDK 7 plus the Langfuse AI SDK integration and OpenTelemetry Node SDK. Keep `openai` and `@opentelemetry/sdk-trace-node` temporarily; Tasks 7 and 8 remove them with their final runtime imports.

- [ ] **Step 3: Verify the expected SDK exports before using them**

Run:

```bash
rtk node -e "Promise.all([import('ai'), import('@langfuse/vercel-ai-sdk'), import('@opentelemetry/sdk-node')]).then(([ai, langfuse, otel]) => { for (const k of ['streamText','Output','registerTelemetry','APICallError','NoObjectGeneratedError','NoSuchProviderError']) if (!(k in ai)) throw new Error('missing ai.'+k); if (!('LangfuseVercelAiSdkIntegration' in langfuse)) throw new Error('missing Langfuse integration'); if (!('NodeSDK' in otel)) throw new Error('missing NodeSDK'); console.log('AI SDK telemetry exports verified') })"
```

Expected: `AI SDK telemetry exports verified`.

- [ ] **Step 4: Confirm only the expected dependency files changed**

Run:

```bash
rtk git diff -- package.json pnpm-lock.yaml
```

- [ ] **Step 5: Commit the dependency migration**

```bash
rtk git add package.json pnpm-lock.yaml
rtk git commit -m "build: add Vercel AI SDK"
```

---

### Task 2: Add a testable AI Gateway adapter

**Files:**

- Create: `src/server/gateway.ts`
- Create: `src/server/gateway.test.ts`

- [ ] **Step 1: Write failing configuration and routing tests**

Create `src/server/gateway.test.ts` with coverage equivalent to:

```ts
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TRANSLATE_MODEL,
  GatewayConfigurationError,
  assertGatewayApiKey,
  gatewayProviderOptions,
  gatewayTags,
  resolveTranslateModel,
} from './gateway'

describe('resolveTranslateModel', () => {
  it('defaults to the exact Gateway model id', () => {
    expect(resolveTranslateModel({})).toBe(DEFAULT_TRANSLATE_MODEL)
    expect(DEFAULT_TRANSLATE_MODEL).toBe('openai/gpt-5.6-luna')
  })

  it('accepts one exact provider/model id', () => {
    expect(resolveTranslateModel({ TRANSLATE_MODEL: 'anthropic/claude-sonnet-4.5' }))
      .toBe('anthropic/claude-sonnet-4.5')
  })

  it.each(['gpt-5.6-luna', 'openai/', '/gpt-5.6-luna', 'openai/model/extra'])
    ('rejects malformed model id %s', (model) => {
      expect(() => resolveTranslateModel({ TRANSLATE_MODEL: model }))
        .toThrow(GatewayConfigurationError)
    })
})

describe('assertGatewayApiKey', () => {
  it('fails closed when the server key is missing', () => {
    expect(() => assertGatewayApiKey({})).toThrow(GatewayConfigurationError)
  })

  it('accepts a non-empty server key', () => {
    expect(() => assertGatewayApiKey({ AI_GATEWAY_API_KEY: 'test-key' }))
      .not.toThrow()
  })
})

describe('gatewayProviderOptions', () => {
  it('uses auto caching and OpenAI-only options for openai models', () => {
    expect(gatewayProviderOptions({
      model: 'openai/gpt-5.6-luna',
      promptCacheKey: 'nt:v12:sentence:en:en:ko:casual',
      tags: ['translation', 'sentence', 'initial', 'v12-ai-gateway'],
    })).toEqual({
      gateway: {
        caching: 'auto',
        tags: ['translation', 'sentence', 'initial', 'v12-ai-gateway'],
      },
      openai: {
        reasoningEffort: 'none',
        store: false,
        promptCacheKey: 'nt:v12:sentence:en:en:ko:casual',
      },
    })
  })

  it('does not send OpenAI options or fallback models to another provider', () => {
    const options = gatewayProviderOptions({
      model: 'anthropic/claude-sonnet-4.5',
      promptCacheKey: 'ignored-by-anthropic',
      tags: ['translation', 'word', 'initial', 'v12-ai-gateway'],
    })
    expect(options).toEqual({
      gateway: {
        caching: 'auto',
        tags: ['translation', 'word', 'initial', 'v12-ai-gateway'],
      },
    })
    expect(options.gateway).not.toHaveProperty('models')
  })
})

describe('gatewayTags', () => {
  it('contains only low-cardinality operational values', () => {
    expect(gatewayTags({
      intent: 'sentence',
      requestKind: 'refinement',
      promptVersion: 'v12-ai-gateway',
    })).toEqual(['translation', 'sentence', 'refinement', 'v12-ai-gateway'])
  })
})

```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run:

```bash
rtk npx vitest run src/server/gateway.test.ts
```

Expected: FAIL because `src/server/gateway.ts` does not exist.

- [ ] **Step 3: Implement the Gateway boundary**

Create `src/server/gateway.ts` with these public contracts and behavior:

```ts
export const DEFAULT_TRANSLATE_MODEL = 'openai/gpt-5.6-luna'

export class GatewayConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GatewayConfigurationError'
  }
}

type TranslationEnvironment = {
  AI_GATEWAY_API_KEY?: string
  TRANSLATE_MODEL?: string
}

export function resolveTranslateModel(
  env: TranslationEnvironment = process.env,
): string {
  const model = env.TRANSLATE_MODEL?.trim() || DEFAULT_TRANSLATE_MODEL
  if (!/^[^/\s]+\/[^/\s]+$/.test(model)) {
    throw new GatewayConfigurationError(
      'TRANSLATE_MODEL must be one exact provider/model identifier.',
    )
  }
  return model
}

export function assertGatewayApiKey(
  env: TranslationEnvironment = process.env,
): void {
  if (!env.AI_GATEWAY_API_KEY?.trim()) {
    throw new GatewayConfigurationError('AI_GATEWAY_API_KEY is not configured.')
  }
}

export function gatewayTags(input: {
  intent: 'word' | 'sentence'
  requestKind: 'initial' | 'context' | 'refinement'
  promptVersion: string
}): string[] {
  return [
    'translation',
    input.intent,
    input.requestKind,
    input.promptVersion,
  ]
}

export function gatewayProviderOptions(input: {
  model: string
  promptCacheKey: string
  tags: string[]
}) {
  const gateway = { caching: 'auto' as const, tags: input.tags }
  if (!input.model.startsWith('openai/')) return { gateway }

  return {
    gateway,
    openai: {
      reasoningEffort: 'none',
      store: false,
      promptCacheKey: input.promptCacheKey,
    },
  }
}

```

If the installed AI SDK types require read-only arrays or a narrower provider-options annotation, adapt the annotations only; do not change the tested runtime object shape.

- [ ] **Step 4: Run the focused test and typecheck**

Run:

```bash
rtk npx vitest run src/server/gateway.test.ts
rtk npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 5: Commit the adapter**

```bash
rtk git add src/server/gateway.ts src/server/gateway.test.ts
rtk git commit -m "feat: add Vercel AI Gateway adapter"
```

---

### Task 3: Isolate local cache entries by exact model

**Files:**

- Modify: `src/server/cacheKey.ts`
- Modify: `src/server/cacheKey.test.ts`
- Modify: `src/server/translate.ts` (one compatibility call site only)

- [ ] **Step 1: Add a failing model-isolation test**

In `src/server/cacheKey.test.ts`, add:

```ts
it('differs when the exact deployment model differs', () => {
  expect(cacheKeyFor(base, 'openai/gpt-5.6-luna')).not.toBe(
    cacheKeyFor(base, 'anthropic/claude-sonnet-4.5'),
  )
})
```

Update every existing `cacheKeyFor` test call to pass `'openai/gpt-5.6-luna'` as the second argument.

- [ ] **Step 2: Confirm the focused tests fail**

Run:

```bash
rtk npx vitest run src/server/cacheKey.test.ts
```

Expected: FAIL because response cache inputs do not contain a model.

- [ ] **Step 3: Implement exact-model cache isolation**

In `src/server/cacheKey.ts`:

```ts
export const CACHE_VERSION = 'v12-ai-gateway'

export type CacheKeyInput = {
  intent: Intent
  mode: Mode
  source: string
  target: string
  uiLang: string
  text: string
  context: string
  refinements: string[]
  previousMain: string
}
```

Change the response-key signature and insert the model immediately after `CACHE_VERSION` in the existing JSON tuple:

```ts
export function cacheKeyFor(d: CacheKeyInput, model: string): string {
  const isWord = d.intent === 'word'
  const anchored = !isWord && d.refinements.length > 0
  return JSON.stringify([
    CACHE_VERSION,
    model,
    d.intent,
    d.mode,
    d.source,
    d.target,
    d.uiLang,
    d.text.trim(),
    d.context.trim(),
    isWord ? [] : d.refinements.map((refinement) => refinement.trim()),
    anchored ? d.previousMain : '',
  ])
}
```

Update the current orchestrator to call `cacheKeyFor(data, MODEL)`. Do not add the model to `promptCacheKeyFor`; that key remains a prompt-shape identifier used inside an already selected model request.

- [ ] **Step 4: Re-run focused tests and typecheck**

Run:

```bash
rtk npx vitest run src/server/cacheKey.test.ts
rtk npx tsc --noEmit
```

Expected: cache tests and typecheck pass after updating the current `translate.ts` call to `cacheKeyFor(data, MODEL)`.

- [ ] **Step 5: Commit the cache contract**

```bash
rtk git add src/server/cacheKey.ts src/server/cacheKey.test.ts src/server/translate.ts
rtk git commit -m "feat: isolate translation cache by model"
```

---

### Task 4: Convert prompts to AI SDK v7 instruction/message bundles

**Files:**

- Modify: `src/server/prompts.ts`
- Modify: `src/server/prompts.test.ts`

- [ ] **Step 1: Replace OpenAI-content assertions with AI SDK message assertions**

Update the prompt aliases and test helper to accept the new bundle and text-only messages:

```ts
type PromptBundle =
  | ReturnType<typeof sentencePrompt>
  | ReturnType<typeof wordPrompt>

function textOf(content: PromptBundle['messages'][number]['content']): string {
  if (typeof content !== 'string') {
    throw new Error('translation prompts must use text-only model messages')
  }
  return content
}
```

Replace the explicit `prompt_cache_breakpoint` test with:

```ts
it('keeps stable instructions before all live content', () => {
  for (const prompt of [sentencePrompt(base), wordPrompt(base)]) {
    expect(prompt.instructions.map((message) => message.role)).toEqual([
      'system',
      'system',
    ])
    expect(prompt.messages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'user',
    ])
    const finalUser = textOf(prompt.messages.at(-1)!.content)
    expect(finalUser).toContain('<source>')
    expect(finalUser.indexOf('(Reminder:')).toBeLessThan(
      finalUser.indexOf('<source>'),
    )
  }
})

it('puts the metadata-language rule first in v7 instructions', () => {
  const english = sentencePrompt(base)
  const korean = sentencePrompt({ ...base, uiLang: 'ko' })
  expect(english.instructions[0]?.role).toBe('system')
  expect(korean.instructions[0]?.role).toBe('system')
  expect(english.instructions[0]!.content).not.toBe(
    korean.instructions[0]!.content,
  )
})

it('keeps instructions and every pre-live message byte-identical', () => {
  const bare = sentencePrompt(base)
  const live = sentencePrompt({
    ...base,
    text: 'different text',
    context: 'private context',
    refinements: ['make it softer'],
    previousMain: 'previous result',
  })
  expect(live.instructions).toEqual(bare.instructions)
  expect(live.messages.slice(0, -1)).toEqual(bare.messages.slice(0, -1))
})
```

Update `assistantOf` and every existing user-message lookup to use `prompt.messages`. Update the prefix-invariant tests to compare both `instructions` entries.

- [ ] **Step 2: Run prompt tests and confirm they fail**

Run:

```bash
rtk npx vitest run src/server/prompts.test.ts
```

Expected: FAIL because prompt content still contains OpenAI Responses content parts and an explicit cache marker.

- [ ] **Step 3: Convert prompt types and final user content**

At the top of `src/server/prompts.ts`:

```ts
import type { ModelMessage, SystemModelMessage } from 'ai'

export type TranslationPrompt = {
  instructions: SystemModelMessage[]
  messages: ModelMessage[]
}
```

Replace `cacheableUserContent` with a string-only helper:

```ts
function finalUserContent(instruction: string, liveInput: string): string {
  return `${instruction}\n${liveInput}`
}
```

Keep each function's existing inline argument object type and add `: TranslationPrompt` after its closing `})`. Do not introduce a second copy of the argument types.

Add one builder that keeps the v7 system instructions out of `messages`:

```ts
function translationPrompt(
  languageRule: string,
  system: string,
  fewshot: { user: string; assistant: string },
  finalUser: string,
): TranslationPrompt {
  return {
    instructions: [
      { role: 'system', content: languageRule },
      { role: 'system', content: system },
    ],
    messages: [
      { role: 'user', content: fewshot.user },
      { role: 'assistant', content: fewshot.assistant },
      { role: 'user', content: finalUser },
    ],
  }
}
```

Use it in sentence mode:

```ts
return translationPrompt(
  metadataLanguageRule(uiLang),
  system,
  sentenceFewshot,
  finalUserContent(
    `(Reminder: ${isPolish ? `polish the upcoming source content in ${langName(target)} — never echo it verbatim` : 'translate the upcoming source content literally'}; rationale/note/formalityNote in ${metaLang}.${pairInvolvesForeign && !isPolish ? ' Populate `learningTips` with a grammar or vocab note (and, for CJK pairs, a character breakdown) useful for a learner — do not leave it empty unless the sentence is genuinely trivial.' : ''})`,
    `${userBlocks({ context, refinements, previousMain })}<source>\n${text}\n</source>`,
  ),
)
```

Use it in word mode:

```ts
return translationPrompt(
  metadataLanguageRule(uiLang),
  system,
  fewshot,
  finalUserContent(
    `(Reminder: treat the upcoming source content as the literal headword to ${isPolish ? 'find in-register synonyms for' : 'define'}; all metadata fields in ${metaLang}; stay in the ${mode.toUpperCase()} register band for primaryTranslation and alternativeTranslations.${pairInvolvesForeign && !isPolish ? ' Populate `learningTips` with a grammar or vocab note (and, for CJK pairs, a character breakdown) useful for a learner — do not leave it empty unless the headword is genuinely trivial.' : ''})`,
    `${userBlocks({ context })}<source>\n${text}\n</source>`,
  ),
)
```

The language rule must be the first `instructions` entry and the remaining stable system prompt the second. The three conversation messages remain few-shot user, few-shot assistant, and final live user.

Remove `metadataLanguageRule(uiLang)` from the beginning of each local `system` array so it appears exactly once through the first `instructions` entry.

Remove all `input_text`, `output_text`, and `prompt_cache_breakpoint` objects. Do not alter prompt wording, examples, register rules, or the ordering of context/refinement/source blocks.

Update the two nearby caching comments to say the stable-first ordering benefits Gateway/provider prefix caching; remove claims about an OpenAI explicit breakpoint.

- [ ] **Step 4: Re-run prompt tests and typecheck**

Run:

```bash
rtk npx vitest run src/server/prompts.test.ts
rtk npx tsc --noEmit
```

Expected: prompt tests pass. Remaining type errors should be limited to the not-yet-migrated `translate.ts` and smoke script.

- [ ] **Step 5: Commit the prompt representation change**

```bash
rtk git add src/server/prompts.ts src/server/prompts.test.ts
rtk git commit -m "refactor: emit AI SDK v7 prompt bundles"
```

---

### Task 5: Add sanitized AI SDK error classification

**Files:**

- Create: `src/server/translationError.ts`
- Create: `src/server/translationError.test.ts`
- Modify: `src/lib/i18n.ts`

- [ ] **Step 1: Write failing error-classification and privacy tests**

Create tests covering:

```ts
import {
  APICallError,
  NoObjectGeneratedError,
  NoSuchProviderError,
} from 'ai'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  classifyTranslationError,
  isTranslationAbort,
  publicTranslationError,
} from './translationError'

function apiError(statusCode: number): unknown {
  return {
    name: 'AI_APICallError',
    statusCode,
    message: 'upstream echoed private source text',
    responseBody: 'private provider body',
  }
}

describe('classifyTranslationError', () => {
  afterEach(() => vi.restoreAllMocks())

  it.each([
    [401, 'authentication'],
    [403, 'authentication'],
    [402, 'budget'],
    [429, 'rate_limit'],
    [400, 'model_configuration'],
    [404, 'model_configuration'],
  ] as const)('maps HTTP %i to %s', (status, expected) => {
    const error = apiError(status)
    vi.spyOn(APICallError, 'isInstance').mockImplementation(
      (candidate): candidate is APICallError => candidate === error,
    )
    expect(classifyTranslationError(error)).toBe(expected)
  })

  it('maps provider resolution and structured output failures', () => {
    const providerError = { name: 'AI_NoSuchProviderError' }
    const objectError = { name: 'AI_NoObjectGeneratedError' }
    vi.spyOn(NoSuchProviderError, 'isInstance').mockImplementation(
      (candidate): candidate is NoSuchProviderError => candidate === providerError,
    )
    vi.spyOn(NoObjectGeneratedError, 'isInstance').mockImplementation(
      (candidate): candidate is NoObjectGeneratedError => candidate === objectError,
    )
    expect(classifyTranslationError(providerError)).toBe('model_configuration')
    expect(classifyTranslationError(objectError)).toBe('structured_output')
  })

  it('never exposes the provider body or message to the browser', () => {
    const error = apiError(401)
    vi.spyOn(APICallError, 'isInstance').mockImplementation(
      (candidate): candidate is APICallError => candidate === error,
    )
    const publicError = publicTranslationError(
      classifyTranslationError(error),
      'en',
    )
    expect(publicError.message).toContain('AI_GATEWAY_API_KEY')
    expect(publicError.message).not.toContain('private')
    expect(publicError).not.toHaveProperty('cause')
  })
})

describe('isTranslationAbort', () => {
  it('recognizes the request signal and AbortError', () => {
    const controller = new AbortController()
    controller.abort()
    expect(isTranslationAbort(new Error('anything'), controller.signal)).toBe(true)
    expect(isTranslationAbort(
      new DOMException('Aborted', 'AbortError'),
      new AbortController().signal,
    )).toBe(true)
  })
})
```

- [ ] **Step 2: Confirm the focused test fails**

Run:

```bash
rtk npx vitest run src/server/translationError.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Add localized, safe browser messages**

Add the same keys to both languages in `src/lib/i18n.ts`:

```ts
gatewayConfigurationFailed: 'AI Gateway is not configured for this deployment.'
gatewayAuthenticationFailed: 'AI Gateway authentication failed. Check AI_GATEWAY_API_KEY.'
gatewayBudgetUnavailable: 'AI Gateway capacity is currently unavailable.'
gatewayRateLimited: 'AI Gateway is temporarily rate limited. Please retry.'
gatewayModelInvalid: 'The configured AI Gateway model or provider options are unsupported.'
gatewayStructuredOutputInvalid: 'The selected model returned an invalid translation result.'
```

Add faithful Korean equivalents and change `errorEnvHint` to mention `AI_GATEWAY_API_KEY` and `TRANSLATE_MODEL`, with no OpenAI-key or LM Studio wording.

- [ ] **Step 4: Implement the classifier and public error factory**

`src/server/translationError.ts` must:

- Use `APICallError.isInstance`, `NoObjectGeneratedError.isInstance`, and `NoSuchProviderError.isInstance` rather than cross-realm `instanceof` checks.
- Map `GatewayConfigurationError` to `configuration`.
- Map HTTP 401/403 to `authentication`, 402 to `budget`, 429 to `rate_limit`, and 400/404 to `model_configuration`.
- Map `NoObjectGeneratedError` to `structured_output`.
- Return `provider` for all other errors.
- Treat `signal.aborted` or an error named `AbortError` as cancellation.
- Construct a fresh `Error` from a `STRINGS[uiLang]` message and attach neither `cause` nor raw upstream data.

The public kind union is:

```ts
export type TranslationErrorKind =
  | 'configuration'
  | 'authentication'
  | 'budget'
  | 'rate_limit'
  | 'model_configuration'
  | 'structured_output'
  | 'provider'
```

- [ ] **Step 5: Run focused tests and typecheck**

Run:

```bash
rtk npx vitest run src/server/translationError.test.ts
rtk npx tsc --noEmit
```

Expected: error tests pass and no new i18n key-shape error appears.

- [ ] **Step 6: Commit the safe error boundary**

```bash
rtk git add src/server/translationError.ts src/server/translationError.test.ts src/lib/i18n.ts
rtk git commit -m "feat: sanitize AI Gateway translation errors"
```

---

### Task 6: Add a pure structured-stream consumer

**Files:**

- Create: `src/server/structuredStream.ts`
- Create: `src/server/structuredStream.test.ts`

- [ ] **Step 1: Write failing tests for delta forwarding and final validation**

Create `src/server/structuredStream.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { consumeStructuredStream } from './structuredStream'

async function* deltas() {
  yield '{"main":"hel'
  yield 'lo"}'
}

describe('consumeStructuredStream', () => {
  it('forwards raw text deltas and returns only the validated output', async () => {
    const onDelta = vi.fn()
    const onFirstToken = vi.fn()
    const validated = { main: 'hello' }
    const result = await consumeStructuredStream({
      textStream: deltas(),
      output: Promise.resolve(validated),
      onDelta,
      onFirstToken,
    })

    expect(onDelta.mock.calls).toEqual([
      ['{"main":"hel'],
      ['lo"}'],
    ])
    expect(onFirstToken).toHaveBeenCalledTimes(1)
    expect(result).toBe(validated)
  })

  it('does not produce a terminal value when validation rejects', async () => {
    const validationError = new Error('invalid structured output')
    await expect(consumeStructuredStream({
      textStream: deltas(),
      output: Promise.reject(validationError),
      onDelta: vi.fn(),
      onFirstToken: vi.fn(),
    })).rejects.toBe(validationError)
  })
})
```

- [ ] **Step 2: Confirm the test fails**

Run:

```bash
rtk npx vitest run src/server/structuredStream.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the minimal consumer**

Create `src/server/structuredStream.ts`:

```ts
export async function consumeStructuredStream<T>(input: {
  textStream: AsyncIterable<string>
  output: PromiseLike<T>
  onDelta: (delta: string) => void
  onFirstToken: () => void
}): Promise<T> {
  let sawFirstToken = false
  for await (const delta of input.textStream) {
    if (!sawFirstToken) {
      sawFirstToken = true
      input.onFirstToken()
    }
    input.onDelta(delta)
  }
  return await input.output
}
```

This helper deliberately does not parse partial JSON. The browser remains the only incremental parser; AI SDK's `output` promise remains the final Zod-validation gate.

- [ ] **Step 4: Run focused tests and typecheck**

Run:

```bash
rtk npx vitest run src/server/structuredStream.test.ts
rtk npx tsc --noEmit
```

Expected: PASS aside from previously recorded `translate.ts` migration errors.

- [ ] **Step 5: Commit the stream contract helper**

```bash
rtk git add src/server/structuredStream.ts src/server/structuredStream.test.ts
rtk git commit -m "test: codify structured streaming contract"
```

---

### Task 7: Migrate the production translation orchestrator to AI Gateway

**Files:**

- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `src/server/translate.ts`
- Create: `src/server/translate.gateway.test.ts`

- [ ] **Step 1: Add a failing request-shape regression test**

Create `src/server/translate.gateway.test.ts` and mock `streamText` before importing the production module. The test must assert the request supplied to the SDK has:

```ts
expect(streamText).toHaveBeenCalledWith(expect.objectContaining({
  model: 'openai/gpt-5.6-luna',
  maxRetries: 0,
  abortSignal: expect.any(AbortSignal),
  instructions: [
    expect.objectContaining({ role: 'system' }),
    expect.objectContaining({ role: 'system' }),
  ],
  messages: [
    expect.objectContaining({ role: 'user' }),
    expect.objectContaining({ role: 'assistant' }),
    expect.objectContaining({ role: 'user' }),
  ],
  output: expect.anything(),
  providerOptions: {
    gateway: {
      caching: 'auto',
      tags: ['translation', 'sentence', 'initial', 'v12-ai-gateway'],
    },
    openai: {
      reasoningEffort: 'none',
      store: false,
      promptCacheKey: expect.stringContaining('nt:v12-ai-gateway'),
    },
  },
}))
expect(streamText).toHaveBeenCalledTimes(1)
expect(streamText.mock.calls[0]![0].providerOptions.gateway)
  .not.toHaveProperty('models')
expect(streamText.mock.calls[0]![0]).not.toHaveProperty('allowSystemInMessages')
```

The fake AI SDK result must provide:

```ts
{
  textStream: deltas(),
  output: Promise.resolve(validSentenceResult),
}
```

Read the returned `ReadableStream` and assert two `delta` chunks are followed by one `done` chunk. Add a second test whose `output` rejects and assert no `done` chunk is emitted or cached. Add a cancellation test that aborts the exact signal passed to `streamText`, then asserts no terminal result is cached and the user-facing stream does not expose an upstream body. Task 8 verifies the native telemetry lifecycle.

If direct invocation of the TanStack server-function wrapper is cumbersome, export an unregistered `handleTranslate(data, requestSignal, dependencies)` function from `translate.ts`; keep `translate` itself as the thin `createServerFn(...).handler` registration. Inject only `streamText` and cache in tests.

- [ ] **Step 2: Run the production migration test and confirm it fails**

Run:

```bash
rtk npx vitest run src/server/translate.gateway.test.ts
```

Expected: FAIL because production still calls OpenAI Responses and does not expose the testable handler.

- [ ] **Step 3: Replace OpenAI imports and model configuration**

Remove the old package now that this task replaces its final runtime imports:

```bash
rtk env CI=true pnpm remove openai
```

In `src/server/translate.ts`, remove:

```ts
import OpenAI from 'openai'
import { zodTextFormat } from 'openai/helpers/zod'
```

Add:

```ts
import { Output, streamText } from 'ai'
import {
  assertGatewayApiKey,
  gatewayProviderOptions,
  gatewayTags,
  resolveTranslateModel,
} from './gateway'
import { consumeStructuredStream } from './structuredStream'
import {
  classifyTranslationError,
  isTranslationAbort,
  publicTranslationError,
} from './translationError'
```

Delete the lazy OpenAI client. Resolve the deployment model once:

```ts
const MODEL = resolveTranslateModel()
```

Also remove `configuredTokenCostDetailsUsd`, `startTranslationTelemetry`, `characterCountBucket`, `telemetryDimensions`, `resultAnalytics`, and their call sites from this staged provider migration. Task 8 adds the native telemetry bootstrap and safe runtime context back through the AI SDK request; do not keep the old manual implementation temporarily wired alongside it.

- [ ] **Step 4: Keep local hits provider-free and isolate the response key**

Build the key as:

```ts
const cacheKey = cacheKeyFor(data, MODEL)
```

Retain the existing local-hit behavior and return before checking Gateway credentials. Delete all manual telemetry creation and updates from the local-hit path; native AI SDK telemetry intentionally produces no trace when no model call occurs.

- [ ] **Step 5: Start one exact-model structured generation**

Immediately before `streamText`, call `assertGatewayApiKey()`. Construct the request:

```ts
const requestKind = dimensions.requestKind
const prompt = isWord ? wordPrompt(data) : sentencePrompt(data)
const result = streamText({
  model: MODEL,
  instructions: prompt.instructions,
  messages: prompt.messages,
  output: Output.object({
    schema: isWord ? WordResult : SentenceResult,
    name: isWord ? 'word_translation' : 'sentence_translation',
  }),
  abortSignal: requestSignal,
  maxRetries: 0,
  providerOptions: gatewayProviderOptions({
    model: MODEL,
    promptCacheKey: promptCacheKeyFor(data),
    tags: gatewayTags({
      intent: data.intent,
      requestKind,
      promptVersion: CACHE_VERSION,
    }),
  }),
})
```

Do not add `providerOptions.gateway.models`, `fallback`, a direct provider package, or an application retry loop.

- [ ] **Step 6: Preserve raw deltas and validate before commit/cache**

Use:

```ts
const parsed = await consumeStructuredStream({
  textStream: result.textStream,
  output: result.output,
  onFirstToken() {},
  onDelta(raw) {
    controller.enqueue({ type: 'delta', raw })
  },
})
```

Only after this resolves:

1. Construct `TranslateDone` using the request intent.
2. Store the final object in `translationCache`.
3. Emit the one `done` chunk and close.

Never cache a partial object or emit a terminal chunk before `result.output` resolves.

- [ ] **Step 7: Preserve cancellation and sanitize all other failures**

In the catch path:

```ts
if (isTranslationAbort(error, requestSignal)) {
  try {
    controller.close()
  } catch {
    // The browser may already have canceled its reader.
  }
} else {
  controller.error(
    publicTranslationError(classifyTranslationError(error), data.uiLang),
  )
}
```

Do not attach the raw error to any custom telemetry object. Task 8 adds a provider-owned flush in `finally`; browser errors remain sanitized here.

- [ ] **Step 8: Run migration, browser-contract, and type tests**

Run:

```bash
rtk npx vitest run src/server/translate.gateway.test.ts src/server/structuredStream.test.ts src/hooks/useTranslate.test.tsx
rtk npx tsc --noEmit
```

Expected: focused tests and typecheck pass, with exactly one mocked SDK request per translation miss.

- [ ] **Step 9: Commit the production path**

```bash
rtk git add package.json pnpm-lock.yaml src/server/translate.ts src/server/translate.gateway.test.ts
rtk git commit -m "feat: route translations through Vercel AI Gateway"
```

---

### Task 8: Replace manual Langfuse spans with AI SDK v7 telemetry

**Files:**

- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Rewrite: `src/server/telemetry.ts`
- Rewrite: `src/server/telemetry.test.ts`
- Modify: `src/server/translate.ts`
- Create: `src/server/translateTypes.ts`
- Create: `src/server/translationDimensions.ts`
- Create: `src/server/translationDimensions.test.ts`
- Delete: `src/server/pricing.ts`
- Delete: `src/server/pricing.test.ts`

- [ ] **Step 1: Write failing native-telemetry privacy and lifecycle tests**

Replace the manual-span tests in `src/server/telemetry.test.ts` with tests for these public contracts:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  SAFE_TRANSLATION_CONTEXT_KEYS,
  isLangfuseConfigured,
  prepareTranslationTelemetry,
  translationRuntimeContext,
  translationTelemetryOptions,
} from './telemetry'

describe('translationTelemetryOptions', () => {
  it('enables native telemetry without recording translation content', () => {
    expect(translationTelemetryOptions(true)).toEqual({
      isEnabled: true,
      recordInputs: false,
      recordOutputs: false,
      functionId: 'translation',
      includeRuntimeContext: SAFE_TRANSLATION_CONTEXT_KEYS,
    })
  })

  it('disables telemetry when Langfuse is not configured', () => {
    expect(translationTelemetryOptions(false).isEnabled).toBe(false)
  })
})

describe('translationRuntimeContext', () => {
  it('contains only allowlisted operational dimensions', () => {
    const context = translationRuntimeContext({
      intent: 'sentence',
      mode: 'casual',
      source: 'en',
      target: 'ko',
      uiLang: 'en',
      text: 'private source text',
      context: 'private reply context',
      refinements: ['private adjustment'],
      analyticsTrigger: 'refinement',
      analyticsSessionId: 'session-id',
      analyticsRunId: 'run-id',
      analyticsSupersedesRunId: 'old-run-id',
      analyticsInputRevision: 3,
    }, 'openai/gpt-5.6-luna', 'v12-ai-gateway')

    expect(Object.keys(context).sort()).toEqual(
      Object.keys(SAFE_TRANSLATION_CONTEXT_KEYS).sort(),
    )
    expect(JSON.stringify(context)).not.toContain('private source text')
    expect(JSON.stringify(context)).not.toContain('private reply context')
    expect(JSON.stringify(context)).not.toContain('private adjustment')
  })
})

describe('isLangfuseConfigured', () => {
  it('requires both credentials', () => {
    expect(isLangfuseConfigured({})).toBe(false)
    expect(isLangfuseConfigured({ LANGFUSE_PUBLIC_KEY: 'pk' })).toBe(false)
    expect(isLangfuseConfigured({
      LANGFUSE_PUBLIC_KEY: 'pk',
      LANGFUSE_SECRET_KEY: 'sk',
    })).toBe(true)
  })
})

describe('prepareTranslationTelemetry', () => {
  afterEach(() => vi.restoreAllMocks())

  it('registers the official integration once and exposes forceFlush', async () => {
    const registerTelemetry = vi.fn()
    const start = vi.fn()
    const forceFlush = vi.fn().mockResolvedValue(undefined)
    const first = await prepareTranslationTelemetry({
      env: { LANGFUSE_PUBLIC_KEY: 'pk', LANGFUSE_SECRET_KEY: 'sk' },
      load: async () => ({
        registerTelemetry,
        integration: {},
        start,
        forceFlush,
      }),
    })
    const second = await prepareTranslationTelemetry({
      env: { LANGFUSE_PUBLIC_KEY: 'pk', LANGFUSE_SECRET_KEY: 'sk' },
      load: async () => { throw new Error('must not initialize twice') },
    })

    expect(start).toHaveBeenCalledTimes(1)
    expect(registerTelemetry).toHaveBeenCalledTimes(1)
    expect(first.enabled).toBe(true)
    expect(second.enabled).toBe(true)
    await first.flush()
    expect(forceFlush).toHaveBeenCalledTimes(1)
  })

  it('fails open when telemetry initialization fails', async () => {
    const telemetry = await prepareTranslationTelemetry({
      env: { LANGFUSE_PUBLIC_KEY: 'pk', LANGFUSE_SECRET_KEY: 'sk' },
      load: async () => { throw new Error('telemetry unavailable') },
    })
    expect(telemetry.enabled).toBe(false)
    await expect(telemetry.flush()).resolves.toBeUndefined()
  })
})
```

Reset the module/global singleton between the two initialization tests through an exported test-only reset guarded by `process.env.NODE_ENV === 'test'`, or isolate each test with `vi.resetModules()`. Do not expose a production reset path.

In `src/server/translate.gateway.test.ts`, extend the expected `streamText` call with:

```ts
runtimeContext: expect.objectContaining({
  intent: 'sentence',
  requestedModel: 'openai/gpt-5.6-luna',
  gatewayCacheMode: 'auto',
}),
telemetry: {
  isEnabled: true,
  recordInputs: false,
  recordOutputs: false,
  functionId: 'translation',
  includeRuntimeContext: SAFE_TRANSLATION_CONTEXT_KEYS,
},
```

Assert the request has no telemetry `metadata`, `include` body-capture option, input/output payload, raw error, or provider-metadata field. Assert local LRU hits never initialize telemetry or call `streamText`.

- [ ] **Step 2: Confirm the focused tests fail**

Run:

```bash
rtk npx vitest run src/server/telemetry.test.ts src/server/translate.gateway.test.ts
```

Expected: FAIL because the current module still creates manual Langfuse observations and the AI SDK request has no native telemetry configuration.

- [ ] **Step 3: Rewrite telemetry as an optional official integration bootstrap**

Replace `src/server/telemetry.ts` with:

```ts
import type { TranslateInputData } from './translateTypes'
import { characterCountBucket } from './translationDimensions'

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

export function isLangfuseConfigured(
  env: Pick<NodeJS.ProcessEnv, 'LANGFUSE_PUBLIC_KEY' | 'LANGFUSE_SECRET_KEY'>,
): boolean {
  return Boolean(
    env.LANGFUSE_PUBLIC_KEY?.trim() && env.LANGFUSE_SECRET_KEY?.trim(),
  )
}

export function translationTelemetryOptions(enabled: boolean) {
  return {
    isEnabled: enabled,
    recordInputs: false,
    recordOutputs: false,
    functionId: 'translation',
    includeRuntimeContext: SAFE_TRANSLATION_CONTEXT_KEYS,
  }
}
```

Move the existing `TranslateInput` inference into a small `src/server/translateTypes.ts` export, and move `characterCountBucket` plus its type/test into `src/server/translationDimensions.ts`. This avoids importing the registered TanStack server function from the telemetry bootstrap.

Implement `translationRuntimeContext(data, model, promptVersion)` with exactly the allowlisted keys above. Values must be strings, numbers, or booleans; use empty strings for absent analytics IDs so the runtime object has a stable key set. Compute `requestKind` from refinements/context exactly as the current manual telemetry does. Never include `text`, context content, refinement values, `previousMain`, prompts, outputs, errors, warnings, or provider metadata.

Implement `prepareTranslationTelemetry()` as a process-global lazy singleton. Its default loader must:

```ts
const [{ registerTelemetry }, { LangfuseVercelAiSdkIntegration }, { LangfuseSpanProcessor }, { NodeSDK }] =
  await Promise.all([
    import('ai'),
    import('@langfuse/vercel-ai-sdk'),
    import('@langfuse/otel'),
    import('@opentelemetry/sdk-node'),
  ])

const processor = new LangfuseSpanProcessor({
  publicKey: env.LANGFUSE_PUBLIC_KEY,
  secretKey: env.LANGFUSE_SECRET_KEY,
  baseUrl: env.LANGFUSE_BASE_URL,
  exportMode: 'immediate',
  mediaUploadEnabled: false,
})
const sdk = new NodeSDK({ spanProcessors: [processor] })
sdk.start()
registerTelemetry(new LangfuseVercelAiSdkIntegration())
```

Do not pass a custom tracer or enable the integration delegate's supplemental provider metadata, headers, schema, blanket runtime context, or request/response body capture. Return `{ enabled: true, flush: () => processor.forceFlush() }`. Preserve `LANGFUSE_BASE_URL`, `LANGFUSE_TRACING_ENVIRONMENT`, and `LANGFUSE_RELEASE` through the processor's supported environment configuration. If either credential is absent, return a disabled no-op without loading any telemetry package. If initialization or flush fails, warn once with a fixed message and return/continue; never log the rejected error object because it may contain environment or exporter details.

Use a process-global singleton key such as `__neotranslateAiTelemetry` so dev HMR cannot register the integration twice. The injectable loader exists only to test registration and failure behavior.

- [ ] **Step 4: Enable native telemetry on the Gateway call**

In `src/server/translate.ts`, after a local-cache miss and before `streamText`:

```ts
const nativeTelemetry = await prepareTranslationTelemetry()
```

Add to `streamText`:

```ts
runtimeContext: translationRuntimeContext(data, MODEL, CACHE_VERSION),
telemetry: translationTelemetryOptions(nativeTelemetry.enabled),
```

In the stream `finally`, call:

```ts
await nativeTelemetry.flush()
```

Do not manually create a request span, generation span, first-token timestamp, usage object, success/failure/cancel outcome, output summary, warning summary, or cost details. AI SDK and `LangfuseVercelAiSdkIntegration` own those model-call lifecycle events.

- [ ] **Step 5: Remove superseded manual observability and pricing code**

Run:

```bash
rtk rg -n "@langfuse/tracing" src scripts
rtk env CI=true pnpm remove @opentelemetry/sdk-trace-node @langfuse/tracing
```

Expected before removal: no `@langfuse/tracing` source or script imports remain after the telemetry rewrite. If another legitimate use is found, retain that package and remove only `@opentelemetry/sdk-trace-node`. Delete `src/server/pricing.ts` and `src/server/pricing.test.ts`. Remove all imports/calls for `startTranslationTelemetry`, `langfuseUsageDetails`, `configuredTokenCostDetailsUsd`, result analytics, manual token normalization, and custom warning normalization.

- [ ] **Step 6: Run telemetry, translation, and type tests**

Run:

```bash
rtk npx vitest run src/server/telemetry.test.ts src/server/translate.gateway.test.ts src/server/translationDimensions.test.ts
rtk npx tsc --noEmit
```

Expected: PASS. The native telemetry request explicitly disables content recording, the official integration registers once, local hits remain untraced, and initialization/export failures are non-fatal.

- [ ] **Step 7: Commit native telemetry migration**

```bash
rtk git add package.json pnpm-lock.yaml src/server/telemetry.ts src/server/telemetry.test.ts src/server/translate.ts src/server/translateTypes.ts src/server/translationDimensions.ts src/server/translationDimensions.test.ts
rtk git add -u src/server/pricing.ts src/server/pricing.test.ts
rtk git commit -m "feat: use AI SDK telemetry with Langfuse"
```

---

### Task 9: Migrate the smoke harness and deployment documentation

**Files:**

- Modify: `scripts/smoke-translate.mjs`
- Modify: `.env.example`
- Modify: `AGENTS.md`
- Modify: `README.md` if it contains OpenAI setup or provider claims

- [ ] **Step 1: Prove no direct OpenAI runtime references remain**

Run:

```bash
rtk rg -n "OPENAI_API_KEY|from 'openai'|openai/helpers|responses\.(stream|parse)|prompt_cache_breakpoint|prompt_cache_options|openai\.responses" . --glob '!docs/superpowers/**' --glob '!pnpm-lock.yaml'
```

Expected before edits: matches in the smoke harness, `.env.example`, `AGENTS.md`, and any stale README text. Runtime source matches should already be gone.

- [ ] **Step 2: Convert the smoke harness to the production SDK path**

In `scripts/smoke-translate.mjs`, replace the OpenAI imports and the existing cache-key import with:

```js
import { Output, streamText } from 'ai'
import {
  assertGatewayApiKey,
  gatewayProviderOptions,
  gatewayTags,
  resolveTranslateModel,
} from '../src/server/gateway.ts'
import {
  CACHE_VERSION,
  promptCacheKeyFor,
} from '../src/server/cacheKey.ts'
```

Resolve and validate the model/key, then replace the existing `messages` assignment and `client.responses.parse` call with:

```js
const prompt =
  intent === 'word' ? wordPrompt(promptArgs) : sentencePrompt(promptArgs)
const result = streamText({
  model: MODEL,
  instructions: prompt.instructions,
  messages: prompt.messages,
  output: Output.object({
    schema: intent === 'word' ? WordResult : SentenceResult,
    name: intent === 'word' ? 'word_translation' : 'sentence_translation',
  }),
  maxRetries: 0,
  providerOptions: gatewayProviderOptions({
    model: MODEL,
    promptCacheKey: promptCacheKeyFor(promptArgs),
    tags: gatewayTags({
      intent,
      requestKind:
        promptArgs.refinements?.length > 0
          ? 'refinement'
          : promptArgs.context
            ? 'context'
            : 'initial',
      promptVersion: CACHE_VERSION,
    }),
  }),
})

for await (const _delta of result.textStream) {
  // Drain the stream; production renders each delta in the browser.
}
const [data, usage] = await Promise.all([result.output, result.usage])
return {
  data,
  ms: Date.now() - t0,
  usage,
}
```

Update the usage log to print AI SDK's native usage fields, including `inputTokens`, `inputTokenDetails.cacheReadTokens`, `inputTokenDetails.cacheWriteTokens`, `outputTokens`, and `totalTokens` when present. Do not add an application usage normalizer or cost calculation. Keep all existing translation-quality assertions.

- [ ] **Step 3: Update `.env.example`**

Document:

```dotenv
# Vercel AI Gateway is the only model-provider path.
AI_GATEWAY_API_KEY=
TRANSLATE_MODEL=openai/gpt-5.6-luna

# Optional content-free AI SDK telemetry export to Langfuse.
LANGFUSE_PUBLIC_KEY=
LANGFUSE_SECRET_KEY=
```

Do not include a plausible secret value.

- [ ] **Step 4: Update contributor documentation**

Update `AGENTS.md` and any matching README sections so they state:

- Vercel AI SDK v7 and AI Gateway are the only production provider path.
- AI SDK v7 requires ESM and Node.js 22+; Vercel Functions remain on `nodejs22.x`.
- `TRANSLATE_MODEL` is one exact `provider/model` string and defaults to `openai/gpt-5.6-luna`.
- There is no model fallback.
- Structured results use `streamText` plus `Output.object`.
- Gateway caching is `auto`; OpenAI-only options are conditional.
- Langfuse uses AI SDK v7 telemetry through `@langfuse/vercel-ai-sdk`, with `recordInputs: false`, `recordOutputs: false`, and an explicit safe runtime-context allowlist.
- Local LRU hits do not call AI SDK and therefore create no Langfuse generation.
- AI Gateway billing is authoritative; the application does not normalize usage or calculate cost. Langfuse may show its own catalog estimate when it recognizes the model.

- [ ] **Step 5: Verify stale provider assumptions are gone**

Run:

```bash
rtk rg -n "OPENAI_API_KEY|from 'openai'|openai/helpers|responses\.(stream|parse)|prompt_cache_breakpoint|prompt_cache_options|openai\.responses" . --glob '!docs/superpowers/**' --glob '!pnpm-lock.yaml'
rtk rg -n "AI_GATEWAY_API_KEY|LANGFUSE_PUBLIC_KEY|openai/gpt-5.6-luna|recordInputs|recordOutputs|vercel.ai-gateway" .env.example AGENTS.md scripts src
```

Expected: the first command returns no matches; the second finds the intended Gateway setup and instrumentation references.

- [ ] **Step 6: Run non-paid verification**

Run:

```bash
rtk npx tsc --noEmit
rtk env CI=true pnpm test
```

Expected: PASS. Do not run the paid smoke harness until a real `AI_GATEWAY_API_KEY` is present in the execution environment.

- [ ] **Step 7: Commit smoke and documentation updates**

```bash
rtk git add scripts/smoke-translate.mjs .env.example AGENTS.md README.md
rtk git commit -m "docs: document AI Gateway deployment"
```

If `README.md` has no provider-related changes, omit it from `git add`.

---

### Task 10: Complete automated and live verification

**Files:**

- Verify: all changed files
- Update only if verification finds a defect: the smallest owning source/test file

- [ ] **Step 1: Run the focused provider suite**

Run:

```bash
rtk npx vitest run src/server/gateway.test.ts src/server/cacheKey.test.ts src/server/prompts.test.ts src/server/translationError.test.ts src/server/structuredStream.test.ts src/server/translate.gateway.test.ts src/server/telemetry.test.ts src/server/translationDimensions.test.ts src/hooks/useTranslate.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run the complete non-paid quality gate**

Run:

```bash
rtk env CI=true pnpm test
rtk npx tsc --noEmit
rtk npm run build
rtk npm run lint
rtk npm run format
```

Expected: all commands exit zero. If formatting fails, use the repository formatter only on touched files, inspect the diff, then rerun the gate.

- [ ] **Step 3: Audit the exact-model and privacy invariants**

Run:

```bash
rtk rg -n "gateway.*models|models.*gateway|maxRetries:\s*[1-9]|experimental_telemetry|OPENAI_API_KEY|TRANSLATE_PRICING_MODEL|TRANSLATE_PRICE_|providerMetadata|responseBody|startTranslationTelemetry|langfuseUsageDetails|configuredTokenCostDetailsUsd" src scripts .env.example AGENTS.md package.json
rtk rg -n "telemetry:\s*translationTelemetryOptions|recordInputs:\s*false|recordOutputs:\s*false|includeRuntimeContext:\s*SAFE_TRANSLATION_CONTEXT_KEYS" src/server
rtk git diff --check
rtk git status --short
```

Expected: the first search finds no fallback model list, automatic retry, legacy telemetry API, OpenAI credential, pricing variables/helpers, manual Langfuse helpers, or raw provider metadata/body capture. The second search finds the required native telemetry privacy configuration. The worktree has no whitespace errors and only intentional files changed.

- [ ] **Step 4: Run the paid Gateway smoke harness when credentials are available**

Precondition: the execution environment supplies `AI_GATEWAY_API_KEY`; `.env` remains uncommitted.

Run:

```bash
rtk npx tsx scripts/smoke-translate.mjs
```

Expected: sentence, word, tone, direction, context, refinement, and same-language polish checks complete through `openai/gpt-5.6-luna`; AI SDK's native usage fields are printed without application-side normalization or cost calculation.

- [ ] **Step 5: Verify one browser request end-to-end**

Run the development server:

```bash
rtk npm run dev
```

In a browser session at width at least 1024px:

1. Select source `en` with `[aria-label='Source language'] [data-testid='lang-chip'][data-value='en']`.
2. Select target `ko` with `[aria-label='Target language'] [data-testid='lang-chip'][data-value='ko']`.
3. Enter one sentence through `[data-testid='input-textarea']`.
4. Confirm partial output appears before the terminal result.
5. Correlate the action with exactly one AI Gateway request and one Langfuse `vercel.ai-gateway` generation.
6. Confirm requested model, response model, TTFT, latency, provider usage, and any Langfuse catalog cost are attributed through native AI SDK telemetry.
7. Inspect Langfuse and confirm it contains no source, context, refinement, prompt, raw output, or parsed translation text.

- [ ] **Step 6: Verify cancellation**

Start a sufficiently long translation, then clear or replace the input before completion. Confirm:

- the browser shows no cancellation error;
- the Gateway request stops;
- the native AI SDK/Langfuse generation closes as canceled or aborted, without an orphaned span;
- no `done` result from the canceled run is cached or displayed.

- [ ] **Step 7: Review deployment configuration and commit any verification-only fix**

Before deployment, confirm the target Vercel environment defines:

```text
AI_GATEWAY_API_KEY
TRANSLATE_MODEL
LANGFUSE_PUBLIC_KEY
LANGFUSE_SECRET_KEY
```

The user is responsible for adding `AI_GATEWAY_API_KEY`; both Langfuse keys are optional and must be present together to enable export. If verification required a code fix, repeat its focused test and the full quality gate, then commit only that fix. Otherwise, do not create an empty verification commit.

---

## Final Acceptance Checklist

- [ ] `openai` is absent from runtime dependencies and imports.
- [ ] Every paid translation uses AI SDK v7 `streamText` through AI Gateway on the Node.js 22+ ESM runtime.
- [ ] System instructions use the v7 `instructions` option and do not require `allowSystemInMessages`.
- [ ] `TRANSLATE_MODEL` is deployment-controlled and validated as one exact `provider/model`.
- [ ] No fallback-model list or non-Gateway provider client exists.
- [ ] `maxRetries` is zero.
- [ ] Sentence and word results stream progressively and commit only after `Output.object` validation.
- [ ] Request cancellation reaches the SDK and is not shown as an error.
- [ ] Local LRU entries are isolated by model and local hits make no Gateway request.
- [ ] OpenAI-only provider options are absent for non-OpenAI model identifiers.
- [ ] Gateway tags and Langfuse traces contain operational metadata only.
- [ ] AI SDK telemetry uses the official Langfuse integration with input/output recording disabled and an explicit runtime-context allowlist.
- [ ] No manual Langfuse spans, application usage normalizer, pricing module, or pricing environment variables remain.
- [ ] AI Gateway remains the authoritative billing surface; any Langfuse cost is its own model-catalog estimate.
- [ ] Smoke, full test suite, typecheck, build, lint, format, browser streaming, telemetry privacy, and cancellation checks pass.
