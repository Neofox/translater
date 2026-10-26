# Speech, transitions, and browser tests implementation plan

> **For agentic workers:** Use test-driven implementation for each task, then review the integrated result. Independent server, playback, and browser tasks may run in parallel.

**Goal:** Implement the three selected features with deployment-controlled speech model selection.

**Architecture:** A thin TanStack server function imports a server-only HTTPS speech implementation. The browser unlocks Web Audio on tap and schedules PCM chunks, with bounded replay caching and cancellation. React ViewTransition wraps result states; only deliberate result changes run as transitions. Vitest Browser Mode runs separately from unit tests and exports trace replay reports.

**Tech stack:** npm, React 19.3, AI SDK 7, TanStack Start, Vitest 5, Playwright.

**Spec:** ../specs/2026-10-26-playback-transitions-traces-design.md

## Constraints

- Keep the existing npm migration changes and translation behavior.
- Default `SPEECH_MODEL=google/gemini-3.8-flash-lite-tts`; optional `SPEECH_VOICE`. Reject invalid configuration. No fallback models, authentication preflight, automatic retries, or speech-content telemetry.
- Never autoplay or generate speech for unfinished results. Stop on result/input changes and unmount; handle provider errors without exposing raw input or credentials.
- Keep mobile toolbars on one line; honor reduced motion. Browser fixtures make no paid requests.
- Work on feature/speech-transitions-tests in the existing checkout to preserve the pending migration work. Initial implementation stayed local; the user subsequently approved pushing the verified changes. Push the feature branch and open a pull request, with a Vercel preview.

## Review focus

- Cancellation while connecting, buffering, or playing: no stale audio or expensive orphan requests.
- Truncated/odd PCM chunks, mismatched formats, and huge output: bounded buffers and clear failure.
- Model redeploy with a different voice: configuration is server controlled and replay is page scoped.
- Mobile menus plus Listen/Copy/Tips: no overflow, accessible names and keyboard controls.
- Streaming text: no animation per token and no delayed controlled-input updates.

## Tasks

### 1. Speech service and configuration

Files: src/server/speech.ts, speech.server.ts, speechTypes.ts, speech*.test.ts.

- [x] Write failing tests for model/voice defaults and overrides, input limits, OIDC without environment tokens, audio format, sanitized failures, and cancellation.
- [x] Implement `speak({data:{text,language,uiLang},signal})` returning `ReadableStream<SpeechChunk>`. Audio chunks are `{type:'audio',audio:Uint8Array,sampleRate:number}`; successful completion ends with `{type:'done'}`. Export the chunk type from speechTypes.ts.
- [x] Verify targeted tests and full unit suite.

### 2. Playback control

Files: src/lib/pcmPlayer.ts, src/hooks/useSpeech.ts, src/components/ListenButton.tsx, associated tests, src/lib/i18n.ts.

- [x] Write failing behavior tests for explicit start/stop, no autoplay, partial PCM frames, replay caching, cancellation, and stale async completion.
- [x] Implement `ListenButton({text,language,disabled?,resetKey?})` with EN/KO labels. Unlock AudioContext synchronously on tap; keep loading/playing until the audio actually finishes, not merely until the network ends.
- [x] Verify tests, typecheck and lint. Parent integrates into OutputPanel.

### 3. Result transitions and integration

Files: src/components/OutputPanel.tsx, src/hooks/useTranslate.ts, src/styles.css, transition tests.

- [x] Verify existing result lifecycle tests, then add behavior coverage for deliberate transition updates.
- [x] Wrap output states in a ViewTransition with short fades; schedule final result/error updates using startTransition while keeping run initialization and deltas urgent. Do not animate the editor. Add reduced-motion rules.
- [x] Mount Listen only for finished non-error results. Disable and reset it on new pending work, edited input, or language changes. Preserve toolbar fitting.

### 4. Replayable browser tests

Files: vitest.browser.config.ts, tests/browser/*, package.json/lock, .gitignore, README/AGENTS.

- [x] Add exact-version browser test dependencies through npm; keep browser tests out of unit discovery.
- [x] Run actual React components with fixture translation and synthetic speech at 382×580 and 594×368. Cover language/context menus, Listen/Stop/replay, cancellation, and reduced motion.
- [x] Enable browser.traceView and HTML reports, with optional Playwright failure traces. Verify artifacts contain recorded steps and DOM snapshots.
- [x] Document run/replay commands and speech env settings. Run full unit/browser tests, typecheck, lint, npm audit, and production build; review the final diff.

## Validation record

- 231 unit tests and 32 Chromium/WebKit mobile browser checks pass.
- Typecheck, ESLint, npm audit (zero vulnerabilities), and Node 24 production build pass.
- Replay report serves through `npm run test:browser:report`; metadata includes recorded steps and DOM snapshots.
- Real SDK regression confirms provider warning contents are suppressed across concurrent requests. Browser tests caught and now cover the immediate-tap playback reset race.
- Root cause and fix: experimental WebSocket speech failed with a connection-related GatewayResponseError (500); current Gateway documentation says speech streaming is unsupported. The documented HTTPS `generateSpeech` path succeeded with the same Gemini model/voice. The service now uses that path with `maxRetries: 0`, explicit telemetry opt-out, and strict WAV validation/metadata removal before PCM chunk delivery.
- Actual live audio passes: `scripts/smoke-speech.mjs` generated a 2.76-second Korean PCM16 mono WAV at 24 kHz in 3.253 seconds; macOS `afinfo` decoded it and `afplay` completed successfully.
- Actual browser flow passes in Chromium and WebKit at 382×580 with real translation, real speech transport, and native AudioContext. Each speech POST returned 200, all nonzero audio buffers played to completion, replay caused no extra request, and Stop closed playback. No browser errors or speech error state. Physical iPhone hardware remains untested.
- Independent review found no remaining actionable issues in the HTTPS correction; 58 targeted server/playback tests independently passed.
- Whole-repository formatting check flags seven unchanged pre-existing files (`.cta.json`, five `.superpowers/sdd` task briefs, and `prettier.config.js`). Changed feature files pass a separate formatting check.
- User approved pushing after reviewing the real audio sample. Commit and push the verified feature branch, open a pull request against master, and inspect its Vercel preview deployment.

## Alternative pronunciation follow-up

- Added compact Listen/Stop beside Copy on sentence and dictionary alternatives. Only completed results offer speech, and alternative requests contain only their text in the target language.
- Main and alternative controls share one active playback owner; switching speakers stops audio or aborts a connecting request. Existing stale-input/pending/settings guards apply to all controls.
- 235 unit tests, 40 Chromium/WebKit browser checks, typecheck, ESLint, formatting, and Node 24 build pass. Independent review found no actionable issues.
- Real WebKit alternative playback returned HTTP 200 with nonzero PCM24k audio that completed; replay/Stop caused no additional request, and the card had no horizontal overflow.
- Extend PR #4 with this follow-up before merging.
