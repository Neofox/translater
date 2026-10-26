# NeoTranslate

A streaming translator built with TanStack Start, React, Tailwind CSS, Nitro, and Vercel AI SDK.

## Development

Use Node.js 22.22.2+, 24.15.0+, or 26+, with npm. Node 24 LTS is recommended for development and matches the Vercel build runtime.

```sh
npm ci
npm run dev
```

The development server listens on port 3000. Vercel uses `npm ci` and `npm run build` from `vercel.json`; no tool bootstrap is needed.

## Validation

```sh
npm run typecheck
npm test
npm run lint
npm run build
```

`npm run format` checks formatting. `npm run check` rewrites formatting and applies lint fixes, so review its changes before committing.

The optional `npx tsx scripts/smoke-translate.mjs` makes a real, potentially billed AI Gateway request. Run it only when deliberately testing the configured model and credentials.

## Browser regression tests

```sh
npx playwright install chromium webkit
npm run test:browser
npm run test:browser:report
```

Open the local URL printed by the report server to replay test steps and DOM snapshots. `npm run test:browser:ui` runs the interactive test UI. Tests cover Chromium and WebKit at 382×580 and 594×368, including reduced motion, toolbar fit, speech cancellation/replay, and result transitions. Speech transport and the audio clock are synthetic, so the suite makes no paid requests. Physical iPhone audio and fold hardware still require device testing.

## Configuration

Vercel AI Gateway uses request-scoped Vercel OIDC authentication. Local or external runtimes can use `AI_GATEWAY_API_KEY`. `TRANSLATE_MODEL` selects one exact `provider/model` identifier; the application has no fallback model or automatic paid retries.

### Pronunciation

Listen appears on completed translations and starts only when tapped. Tap Stop to cancel; editing the input, changing translation settings, or leaving the page also stops playback. Completed audio has a small in-memory replay cache for this page; reloading clears it. Listen supports up to 4,000 characters, with bounded audio delivery and no automatic retry or provider fallback. The server waits for the complete WAV over HTTPS, validates it, and sends PCM chunks to the browser; playback starts after generation completes.

```sh
SPEECH_MODEL=google/gemini-3.8-flash-lite-tts
# Optional; Google models default to Kore:
SPEECH_VOICE=Kore
```

Set these in Vercel's environment settings, redeploy, and reload the page to switch the pronunciation model or voice. `SPEECH_MODEL` is independent of `TRANSLATE_MODEL` and must be one exact AI Gateway speech model identifier. An unset value uses the Flash-Lite model above. Other models must support AI SDK HTTPS speech generation with mono PCM16 WAV output at 8–48 kHz; choose a voice supported by that model. A model that cannot return this format fails visibly rather than silently switching providers. Authentication uses the same AI Gateway credentials as translation.

For a deliberate, potentially billed live audio check, run `npx tsx scripts/smoke-speech.mjs`. It calls the production speech service and saves a short Korean WAV in the system temporary directory. Set `DOTENV_CONFIG_PATH` to a fresh development env file if needed; the script reports only model/audio measurements and sanitized failures.

Result transitions use React ViewTransition for settled results, keep streaming text immediate, and respect reduced-motion preferences. Browsers without View Transition support render normal updates.

Langfuse tracing is optional and requires both `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY`. Langfuse SDK 6 requires Langfuse Cloud or self-hosted Langfuse 4.59.0+. Traces exclude translation inputs and outputs.

Keep credentials in ignored environment files or Vercel environment settings.

## Dependency updates

Direct dependencies are pinned to exact versions and `package-lock.json` records the complete dependency tree. Commit both when updating dependencies; use `npm outdated` and `npm audit` to review their status.

Two compatibility constraints currently prevent using every latest release:

- TypeScript 6.0.3 remains necessary for the compiler API used by the ESLint toolchain. TypeScript 7 CLI checking works, but its programmatic API is incompatible with those tools.
- OpenTelemetry SDK and exporters use 0.223.0 (SDK 2). Langfuse 6.0.2 and AI SDK telemetry require the API 1.9 line; OpenTelemetry 0.300.0 (SDK 3) requires API 1.10. The exporter peer dependencies are explicit to keep npm from mixing the two SDK generations.

Nitro remains on its newest published 3.x beta because the application already uses the Nitro 3 Vite integration.
