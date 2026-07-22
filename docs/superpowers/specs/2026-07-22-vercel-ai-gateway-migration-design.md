# Vercel AI Gateway and AI SDK Migration Design

**Date:** 2026-07-22
**Status:** Approved for implementation planning

## Summary

Migrate neotranslate from the OpenAI Node SDK to Vercel AI SDK v7 and route every paid translation through Vercel AI Gateway. The selected model remains a deployment concern, configured through `TRANSLATE_MODEL` as an exact `provider/model` identifier. The application will not expose model selection in the UI and will not fall back to a different model.

The migration must preserve the current product behavior: strict Zod-validated sentence and word results, incremental rendering, request cancellation, local LRU caching, and privacy-safe Langfuse traces.

## Goals

- Replace the direct OpenAI SDK integration with Vercel AI SDK v7.
- Authenticate AI Gateway requests with `AI_GATEWAY_API_KEY`.
- Allow model trials by changing only deployment configuration.
- Preserve the current browser streaming contract and rendered translation experience.
- Keep one exact configured model per deployment, with no alternative-model fallback.
- Replace the manual Langfuse span implementation with AI SDK v7 telemetry and Langfuse's official AI SDK integration.
- Keep AI SDK telemetry content-free with input and output recording disabled.

## Non-goals

- No user-facing model or provider selector.
- No automatic fallback to another model.
- No prompt redesign, schema redesign, or translation UX changes.
- No adoption of AI SDK UI hooks or AI SDK transport protocols.
- No custom Langfuse generation spans, usage normalization, or application-side cost calculation.
- No unrelated refactoring of translation, caching, or client state.

## Decisions

### SDK and Gateway routing

Add the `ai` v7 package and remove the `openai` package. Translation requests will use `streamText()` with a plain `provider/model` string. In AI SDK, that string selects AI Gateway as the global provider and the Gateway provider reads `AI_GATEWAY_API_KEY` from the environment.

AI SDK v7 requires ESM and Node.js 22 or later. The project already declares `"type": "module"`, uses `.mjs` for the smoke harness, runs locally on a newer Node release, and configures Vercel Functions with `nodejs22.x`; no runtime downgrade or CommonJS compatibility layer is needed.

`TRANSLATE_MODEL` must contain a slash and represent one exact Gateway model, for example `openai/gpt-5.6-luna`. The default will become `openai/gpt-5.6-luna`. No `providerOptions.gateway.models` fallback list will be configured. Gateway may route the same model across its available hosting providers, but it must not change the model identifier.

AI SDK retries will be disabled with `maxRetries: 0`. A transient failure will surface to the existing error path and the user may explicitly retry. This avoids hidden repeated paid requests.

### Authentication

`AI_GATEWAY_API_KEY` is the only required model-provider credential. `OPENAI_API_KEY` will be removed from examples, runtime assumptions, and user-facing error hints. Missing Gateway credentials must fail before generation begins with a sanitized configuration error.

### Prompt representation

`sentencePrompt()` and `wordPrompt()` will return an AI SDK prompt bundle with `instructions` and `messages` rather than OpenAI Responses input objects. AI SDK v7 renamed the top-level system setting to `instructions`; system messages will not be placed inside `messages`, so `allowSystemInMessages` is unnecessary.

- The current developer language rule becomes the first entry in the `instructions` array.
- The existing system instructions follow it as the second `instructions` entry in the same stable order.
- Few-shot user and assistant messages remain in their current order and retain their exact textual JSON examples.
- The final user input continues to place stable instructions before live source, context, and refinement content.
- OpenAI-specific `input_text`, `output_text`, and `prompt_cache_breakpoint` objects are removed.

This is a representation change only. Prompt wording and few-shot content are not redesigned as part of this migration.

### Structured streaming

Each request will call `streamText()` with `Output.object({ schema, name })`, using the existing `SentenceResult` or `WordResult` Zod schema.

The server will consume `result.textStream`. These are the generated text deltas that make up the structured JSON response. Each delta will continue to be emitted as the existing `{ type: 'delta', raw }` `TranslateChunk`. The browser will continue accumulating those fragments and parsing them with `partial-json`, so the client hook and progressive rendering contract remain unchanged.

After the stream ends, the server will await `result.output`. AI SDK validates that complete object against the selected Zod schema. Only this validated object may be cached or emitted in the terminal `{ type: 'done' }` chunk.

The active TanStack request signal will be passed as `abortSignal`. Aborts must stop Gateway work, close the translation stream, and allow the AI SDK telemetry lifecycle to end the model call as aborted without producing a user-facing error.

### Provider-neutral and provider-specific options

All requests use these common settings:

- the exact `TRANSLATE_MODEL` value;
- `Output.object()` with the relevant strict schema;
- `abortSignal` from the TanStack request;
- `maxRetries: 0`;
- Gateway automatic caching;
- privacy-safe Gateway tags.

`providerOptions.gateway.caching` will be set to `auto`. Gateway can add cache markers for providers that require explicit caching while implicit-cache providers continue using their native behavior.

Provider-specific settings are derived from the `provider/` prefix and are never sent to an unrelated provider. For `openai/*` models, preserve the current behavior with:

- `reasoningEffort: 'none'`;
- `store: false`;
- `promptCacheKey` from the existing prompt-shape cache key.

Other providers receive no OpenAI-specific settings. Additional provider-specific tuning is out of scope until a concrete alternative model demonstrates a need for it.

### Local response cache

The in-memory LRU behavior stays unchanged. Local hits return the existing `{ type: 'cache' }` terminal chunk, create no Gateway generation, and have zero provider cost.

The current cache key does not contain the model. Add the exact `TRANSLATE_MODEL` value to the response-cache key and bump `CACHE_VERSION` so a model switch cannot reuse a result generated by a different model. Keep the separate OpenAI prompt-cache key model-independent because it is used only as a stable prompt-shape identifier within the already selected model request.

## Telemetry and cost

### AI SDK v7 telemetry with Langfuse

Replace the manual `startTranslationTelemetry()` request/generation spans with the official AI SDK v7 integration:

- add `@langfuse/vercel-ai-sdk` and `@opentelemetry/sdk-node`;
- retain `@langfuse/otel` as the exporter;
- remove the direct `@opentelemetry/sdk-trace-node` setup and all manual Langfuse observations;
- initialize one `NodeSDK` with `LangfuseSpanProcessor` and register one `LangfuseVercelAiSdkIntegration` through AI SDK's `registerTelemetry()` before the first model call;
- retain a serverless `forceFlush()` path after each completed, failed, or aborted request;
- keep Langfuse optional when either credential is absent.

Every Gateway `streamText()` call will set:

```ts
telemetry: {
  isEnabled: telemetryEnabled,
  recordInputs: false,
  recordOutputs: false,
  functionId: 'translation',
  includeRuntimeContext: SAFE_TRANSLATION_CONTEXT_KEYS,
}
```

The corresponding `runtimeContext` contains only privacy-safe operational dimensions:

- intent, mode, and request kind;
- source, target, and UI language codes;
- context presence and refinement count, never their content;
- input-length bucket, polish flag, trigger, and prompt version;
- requested model and Gateway cache mode;
- ephemeral analytics/run identifiers already used for request correlation.

AI SDK v7 excludes runtime-context keys unless they are explicitly enabled, so `SAFE_TRANSLATION_CONTEXT_KEYS` is an allowlist rather than a dynamic pass-through.

Prompt text, source text, context, refinements, prompt bodies, raw model output, parsed translation output, raw request bodies, and raw provider metadata must never be sent to Langfuse. `recordInputs: false` and `recordOutputs: false` are mandatory and covered by request-shape tests. Do not attach raw AI SDK result/error objects to `runtimeContext` or telemetry.

Keep the official integration's OpenTelemetry supplemental fields at their privacy-preserving defaults: provider metadata, request headers, schema content, and runtime-context passthrough remain disabled. The explicit `includeRuntimeContext` allowlist is the only path for application dimensions. AI SDK v7's separate request/response body inclusion is also left off.

AI SDK/Langfuse automatically owns the generation lifecycle, including:

- requested and response model attribution;
- provider call duration and first-chunk timing;
- finish reason, errors, and abort lifecycle;
- normalized token usage exposed by the provider;
- generation/span naming and hierarchy.

The application will no longer manually mark first token, success, failure, or cancellation. It will also no longer build safe output summaries such as resolved language or output-length bucket after completion, because adding post-generation manual observations would recreate the implementation this migration removes.

Local LRU hits do not call AI SDK and therefore do not create Langfuse traces. They remain visible only through application behavior and have zero Gateway usage.

Gateway tags may contain only low-cardinality operational values such as `translation`, intent, request kind, and prompt version. The ephemeral browser analytics session ID will not be sent as a Gateway user identifier.

### Pricing integrity

AI Gateway is the authoritative source for billed usage and cost. Remove `src/server/pricing.ts`, its tests, `TRANSLATE_PRICING_MODEL`, and the four `TRANSLATE_PRICE_*` variables.

The official Langfuse integration receives model and token usage from AI SDK and may calculate an estimated cost when its own model catalog recognizes the exact model. The application will neither override nor synthesize that value. If Langfuse does not recognize a model, its cost may remain absent; the server must not fetch model catalog pricing or publish a stale custom estimate.

### Privacy and failure isolation

Telemetry initialization and export failures remain non-fatal. They may emit one sanitized server warning but must never interrupt translation.

The `LangfuseSpanProcessor` keeps its default LLM-focused export filter. Input/output recording is disabled at the AI SDK call boundary. Live verification must inspect successful, failed, and aborted traces for accidental content before deployment.

The previous manual usage buckets and generation metadata are removed rather than duplicated. In particular, the application no longer manually stores:

- output-length/result-shape summaries;
- warning categories;
- custom exclusive cache-read/cache-write token buckets;
- application-calculated cost details.

## Error handling

The server will distinguish these outcomes without exposing upstream response bodies:

- **Canceled:** let AI SDK emit its abort lifecycle; do not show an error.
- **Missing or malformed configuration:** return a concise Gateway configuration message.
- **Authentication failure:** advise checking `AI_GATEWAY_API_KEY`.
- **Budget or credit failure:** report that Gateway capacity is unavailable without exposing account details.
- **Rate limit:** report a temporary rate limit and allow an explicit retry.
- **Unsupported model or provider option:** report a deployment configuration error.
- **Structured-output failure:** report that the selected model did not return a valid translation result.
- **Other provider or network failure:** retain the generic translated failure message.

The browser receives only the application's sanitized errors. The application must not attach raw exceptions, response bodies, or provider messages to telemetry/runtime context; the official integration owns its standard error lifecycle.

## File-level impact

- `package.json` and lockfile: add `ai`, `@langfuse/vercel-ai-sdk`, and `@opentelemetry/sdk-node`; remove `openai` and `@opentelemetry/sdk-trace-node`.
- `src/server/translate.ts`: replace OpenAI Responses streaming with `streamText()` and `Output.object()`; preserve chunking, cancellation, local caching, and terminal validation.
- `src/server/prompts.ts`: emit AI SDK model messages and remove OpenAI-only content parts and cache markers.
- `src/server/cacheKey.ts`: add exact-model isolation to the local response key, bump the cache version, and retain the OpenAI prompt cache key for OpenAI models.
- `src/server/telemetry.ts`: replace manual spans with optional, singleton AI SDK/Langfuse integration initialization, a safe runtime-context allowlist, and serverless flush.
- `src/server/pricing.ts` and its tests: remove application-side cost calculation.
- `src/lib/i18n.ts`: replace OpenAI credential hints with Gateway-specific hints.
- `scripts/smoke-translate.mjs`: exercise the same AI SDK/Gateway structured-output path as production.
- `.env.example`: document `AI_GATEWAY_API_KEY`, `provider/model` syntax, and optional Langfuse credentials; remove application pricing variables.
- `AGENTS.md`: update architecture, caching, telemetry, and commands documentation.
- Relevant tests: update prompt fixtures and add Gateway-specific request, telemetry privacy/configuration, error, and cancellation coverage.

## Verification strategy

### Automated verification

- Unit-test conversion of both prompt modes to valid AI SDK messages.
- Assert stable message ordering and that live content remains at the tail.
- Assert exact model routing with no fallback-model configuration.
- Assert OpenAI-only options appear only for `openai/*` models.
- Assert raw structured text deltas preserve the current browser chunk contract.
- Assert only a fully validated final object is cached and committed.
- Assert aborts reach AI SDK and do not produce a browser error.
- Assert AI SDK telemetry is enabled only with complete Langfuse credentials.
- Assert `recordInputs` and `recordOutputs` are always false.
- Assert the runtime-context allowlist contains only privacy-safe dimensions.
- Assert telemetry initialization/export failures do not fail translation.
- Assert safe error mapping for authentication, rate limits, budget errors, invalid models, and schema failures.
- Run the full Vitest suite, `npx tsc --noEmit`, and the production build.

### Live verification

With `AI_GATEWAY_API_KEY` configured:

1. Run the Gateway-backed smoke harness with `openai/gpt-5.6-luna`.
2. Validate representative sentence, word, tone, language-direction, and same-language polish cases.
3. Drive one browser translation and correlate it with exactly one Gateway request and one Langfuse generation.
4. Confirm streaming renders before the final object completes.
5. Confirm model, TTFT, latency, provider usage, and any Langfuse catalog cost are correctly attributed.
6. Confirm Langfuse contains no source, prompt, context, refinement, or output content.
7. Cancel one in-flight translation and confirm Gateway work stops and the native telemetry lifecycle closes without an orphaned generation.

## Rollout and rollback

This is a direct provider-path migration rather than a dual-write rollout. The production environment must define `AI_GATEWAY_API_KEY` and `TRANSLATE_MODEL`. Langfuse export remains optional and requires both `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY`.

Deployment fails closed when Gateway configuration is missing or invalid. Rollback is performed by reverting the migration commit and restoring `OPENAI_API_KEY`; there is no runtime switch that silently bypasses Gateway.

## Acceptance criteria

- Production translation uses Vercel AI SDK and AI Gateway, not the OpenAI SDK.
- Changing `TRANSLATE_MODEL` to another supported `provider/model` requires no application code change.
- A request never falls back to a different model.
- Sentence and word output remains strictly schema-validated and progressively rendered.
- Client cancellation reaches the Gateway request and closes native telemetry cleanly.
- Local LRU behavior remains intact.
- Gateway and Langfuse usage are attributable without storing translation content.
- No manual Langfuse spans, token normalization, or application-side pricing remain.
- Automated checks and the live smoke/cancellation verification pass.
