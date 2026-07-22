# Vercel AI Gateway and AI SDK Migration Design

**Date:** 2026-07-22
**Status:** Approved for implementation planning

## Summary

Migrate neotranslate from the OpenAI Node SDK to Vercel AI SDK v6 and route every paid translation through Vercel AI Gateway. The selected model remains a deployment concern, configured through `TRANSLATE_MODEL` as an exact `provider/model` identifier. The application will not expose model selection in the UI and will not fall back to a different model.

The migration must preserve the current product behavior: strict Zod-validated sentence and word results, incremental rendering, request cancellation, local LRU caching, privacy-safe Langfuse traces, and deployment-controlled cost metadata.

## Goals

- Replace the direct OpenAI SDK integration with Vercel AI SDK v6.
- Authenticate AI Gateway requests with `AI_GATEWAY_API_KEY`.
- Allow model trials by changing only deployment configuration and model-specific pricing configuration.
- Preserve the current browser streaming contract and rendered translation experience.
- Keep one exact configured model per deployment, with no alternative-model fallback.
- Keep telemetry content-free and make stale Langfuse cost estimates fail closed.

## Non-goals

- No user-facing model or provider selector.
- No automatic fallback to another model.
- No prompt redesign, schema redesign, or translation UX changes.
- No adoption of AI SDK UI hooks or AI SDK transport protocols.
- No replacement of the existing Langfuse instrumentation with AI SDK telemetry.
- No unrelated refactoring of translation, caching, or client state.

## Decisions

### SDK and Gateway routing

Add the `ai` v6 package and remove the `openai` package. Translation requests will use `streamText()` with a plain `provider/model` string. In AI SDK, that string selects AI Gateway as the global provider and the Gateway provider reads `AI_GATEWAY_API_KEY` from the environment.

`TRANSLATE_MODEL` must contain a slash and represent one exact Gateway model, for example `openai/gpt-5.6-luna`. The default will become `openai/gpt-5.6-luna`. No `providerOptions.gateway.models` fallback list will be configured. Gateway may route the same model across its available hosting providers, but it must not change the model identifier.

AI SDK retries will be disabled with `maxRetries: 0`. A transient failure will surface to the existing error path and the user may explicitly retry. This avoids hidden repeated paid requests.

### Authentication

`AI_GATEWAY_API_KEY` is the only required model-provider credential. `OPENAI_API_KEY` will be removed from examples, runtime assumptions, and user-facing error hints. Missing Gateway credentials must fail before generation begins with a sanitized configuration error.

### Prompt representation

`sentencePrompt()` and `wordPrompt()` will return AI SDK `ModelMessage[]` rather than OpenAI Responses input objects.

- The current developer language rule becomes the first system-level instruction.
- The existing system instructions follow it in the same stable order.
- Few-shot user and assistant messages remain in their current order and retain their exact textual JSON examples.
- The final user input continues to place stable instructions before live source, context, and refinement content.
- OpenAI-specific `input_text`, `output_text`, and `prompt_cache_breakpoint` objects are removed.

This is a representation change only. Prompt wording and few-shot content are not redesigned as part of this migration.

### Structured streaming

Each request will call `streamText()` with `Output.object({ schema, name })`, using the existing `SentenceResult` or `WordResult` Zod schema.

The server will consume `result.textStream`. These are the generated text deltas that make up the structured JSON response. Each delta will continue to be emitted as the existing `{ type: 'delta', raw }` `TranslateChunk`. The browser will continue accumulating those fragments and parsing them with `partial-json`, so the client hook and progressive rendering contract remain unchanged.

After the stream ends, the server will await `result.output`. AI SDK validates that complete object against the selected Zod schema. Only this validated object may be cached or emitted in the terminal `{ type: 'done' }` chunk.

The active TanStack request signal will be passed as `abortSignal`. Aborts must stop Gateway work, close the translation stream, and mark the Langfuse request as canceled without producing a user-facing error.

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

### Langfuse

Retain the existing manual Langfuse v5 instrumentation. Do not enable AI SDK experimental telemetry.

Rename the provider generation from `openai.responses` to `vercel.ai-gateway`. Traces may include only the existing privacy-safe dimensions plus:

- requested model;
- response model ID;
- prompt version;
- Gateway cache mode;
- sanitized Gateway warning categories, when present.

Prompt text, source text, context, refinements, prompt bodies, raw model output, parsed translation output, raw request bodies, and raw provider metadata must never be sent to Langfuse.

Gateway tags may contain only low-cardinality operational values such as `translation`, intent, request kind, and prompt version. The ephemeral browser analytics session ID will not be sent as a Gateway user identifier.

### Usage normalization

Normalize AI SDK `LanguageModelUsage` into the existing exclusive buckets:

- `input`: total input tokens;
- `cachedInput`: `inputTokenDetails.cacheReadTokens`;
- `cacheWriteInput`: `inputTokenDetails.cacheWriteTokens`;
- `output`: output tokens;
- `total`: total tokens.

Missing optional usage details become zero. Ordinary input remains `input - cachedInput - cacheWriteInput`, clamped at zero. This preserves the current Langfuse usage schema and cost breakdown.

### Pricing integrity

AI Gateway is the authoritative source for billed cost. Keep the current four `TRANSLATE_PRICE_*` variables for Langfuse estimates and add `TRANSLATE_PRICING_MODEL`.

Langfuse cost details are emitted only when:

1. all four pricing variables are valid; and
2. `TRANSLATE_PRICING_MODEL` exactly equals `TRANSLATE_MODEL`.

If either condition fails, usage is still recorded but estimated cost is omitted. The server must not fetch model catalog pricing on the translation request path and must not report a potentially stale estimate.

## Error handling

The server will distinguish these outcomes without exposing upstream response bodies:

- **Canceled:** mark telemetry canceled; do not show an error.
- **Missing or malformed configuration:** return a concise Gateway configuration message.
- **Authentication failure:** advise checking `AI_GATEWAY_API_KEY`.
- **Budget or credit failure:** report that Gateway capacity is unavailable without exposing account details.
- **Rate limit:** report a temporary rate limit and allow an explicit retry.
- **Unsupported model or provider option:** report a deployment configuration error.
- **Structured-output failure:** report that the selected model did not return a valid translation result.
- **Other provider or network failure:** retain the generic translated failure message.

Sanitized error telemetry may retain an error class, safe code, and HTTP status. It must not retain provider messages that could echo request content.

## File-level impact

- `package.json` and lockfile: add `ai`, remove `openai`.
- `src/server/translate.ts`: replace OpenAI Responses streaming with `streamText()` and `Output.object()`; preserve chunking, cancellation, local caching, and terminal validation.
- `src/server/prompts.ts`: emit AI SDK model messages and remove OpenAI-only content parts and cache markers.
- `src/server/cacheKey.ts`: add exact-model isolation to the local response key, bump the cache version, and retain the OpenAI prompt cache key for OpenAI models.
- `src/server/telemetry.ts`: rename the generation, normalize AI SDK usage, and retain content-free metadata.
- `src/server/pricing.ts`: require the pricing-model match before calculating Langfuse estimates.
- `src/lib/i18n.ts`: replace OpenAI credential hints with Gateway-specific hints.
- `scripts/smoke-translate.mjs`: exercise the same AI SDK/Gateway structured-output path as production.
- `.env.example`: document `AI_GATEWAY_API_KEY`, `provider/model` syntax, `TRANSLATE_PRICING_MODEL`, and model-specific rates.
- `AGENTS.md`: update architecture, caching, telemetry, and commands documentation.
- Relevant tests: update prompt fixtures and add Gateway-specific request, usage, pricing, error, and cancellation coverage.

## Verification strategy

### Automated verification

- Unit-test conversion of both prompt modes to valid AI SDK messages.
- Assert stable message ordering and that live content remains at the tail.
- Assert exact model routing with no fallback-model configuration.
- Assert OpenAI-only options appear only for `openai/*` models.
- Assert raw structured text deltas preserve the current browser chunk contract.
- Assert only a fully validated final object is cached and committed.
- Assert aborts cancel generation and produce canceled telemetry.
- Assert AI SDK usage maps into mutually exclusive Langfuse buckets.
- Assert mismatched or incomplete pricing configuration omits cost.
- Assert safe error mapping for authentication, rate limits, budget errors, invalid models, and schema failures.
- Run the full Vitest suite, `npx tsc --noEmit`, and the production build.

### Live verification

With `AI_GATEWAY_API_KEY` configured:

1. Run the Gateway-backed smoke harness with `openai/gpt-5.6-luna`.
2. Validate representative sentence, word, tone, language-direction, and same-language polish cases.
3. Drive one browser translation and correlate it with exactly one Gateway request and one Langfuse generation.
4. Confirm streaming renders before the final object completes.
5. Confirm model, TTFT, latency, cache-read/write usage, and cost policy are correct.
6. Confirm Langfuse contains no source, prompt, context, refinement, or output content.
7. Cancel one in-flight translation and confirm Gateway work stops and Langfuse records a canceled outcome.

## Rollout and rollback

This is a direct provider-path migration rather than a dual-write rollout. The production environment must define `AI_GATEWAY_API_KEY`, `TRANSLATE_MODEL`, `TRANSLATE_PRICING_MODEL`, and the four matching price variables before deployment.

Deployment fails closed when Gateway configuration is missing or invalid. Rollback is performed by reverting the migration commit and restoring `OPENAI_API_KEY`; there is no runtime switch that silently bypasses Gateway.

## Acceptance criteria

- Production translation uses Vercel AI SDK and AI Gateway, not the OpenAI SDK.
- Changing `TRANSLATE_MODEL` to another supported `provider/model` requires no application code change.
- A request never falls back to a different model.
- Sentence and word output remains strictly schema-validated and progressively rendered.
- Client cancellation reaches the Gateway request and is recorded as canceled.
- Local LRU behavior remains intact.
- Gateway and Langfuse usage are attributable without storing translation content.
- Langfuse cost is present only when pricing explicitly matches the selected model.
- Automated checks and the live smoke/cancellation verification pass.
