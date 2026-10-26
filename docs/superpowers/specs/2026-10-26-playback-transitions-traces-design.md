# Pronunciation, result transitions, and browser traces

## Intent

Add the three features selected by the user while preserving the compact iPhone layout and immediate streamed text updates.

The user's priority is accurate pronunciation for learning. Low cost, convenient integration, and natural-sounding delivery are insufficient reasons to enable a voice whose pronunciation has not been checked.

## Proposed behavior

- **Result transitions:** use React 19.3 ViewTransition for deliberate changes between result states. Keep individual text deltas immediate. Use short fades, respect reduced motion, and retain a normal rendering fallback.
- **Pronunciation:** show a compact Listen button beside Copy for a finished translation. Read only the main translation in its target language. Tap again to stop; changing the translation or leaving the page cancels playback and the request. Show loading and recoverable error states with English/Korean accessible labels. Never autoplay.
- **Speech service (selected by the user):** use `google/gemini-3.8-flash-lite-tts` through the existing Vercel AI Gateway with request-scoped OIDC. `SPEECH_MODEL` selects one exact deployment-controlled provider/model, matching the translation configuration pattern; a redeploy and page reload apply a change. `SPEECH_VOICE` optionally overrides the voice, with Kore as the Google default. Models must support HTTPS generation of mono PCM16 WAV audio. Each new AI playback may incur usage; no automatic retries or fallback models. Replay may reuse a small bounded in-memory audio cache. The user chose Flash-Lite after reviewing quality and price; do not block implementation on another provider audition.
- **iPhone playback:** unlock Web Audio within the tap handler and schedule validated PCM chunks after HTTPS generation completes; handle odd byte boundaries and stop queued audio immediately. Keep the toolbar on one line at the tested narrow widths.
- **Browser traces:** add a separate Vitest 5 Browser Mode suite using Playwright, with DOM trace replay and retained failure artifacts. Exercise mobile toolbar/menu behavior, result changes, reduced motion, and Listen/Stop using fixtures and synthetic audio. Automated regression tests make no paid AI requests.

## Approaches

Prefer the existing Gateway when it serves the voice that passes evaluation. A separate provider integration is acceptable if it produces materially better pronunciation. Device speech is an audition baseline, with voices varying by device, rather than an assumed quality default. Keep the current unit suite separate from the new browser suite.

## Pronunciation evidence and acceptance

Research snapshot: 2026-10-26. [Artificial Analysis](https://artificialanalysis.ai/text-to-speech/models) reports English pronunciation robustness of 93.2% for Fish Audio Drama 3 Preview and Ming-3.0-tts, 91.7% for Eleven v4, 89.5% for Gemini 3.8 Flash TTS, and 87.4% for Flash-Lite. Confidence intervals overlap; these numbers do not establish a Korean winner. Its [methodology](https://artificialanalysis.ai/methodology/text-to-speech/pronunciation-robustness-overview) measures highlighted hard readings, separately from listener preference.

[Fish's technical report](https://arxiv.org/html/2610.18010v1#S5.SS3.SSS2) includes Korean and other languages, but uses ASR error rates and vendor-run comparisons. It is supporting evidence, not native-speaker proof of correct pronunciation. [Vercel confirms](https://vercel.com/changelog/drama-3-now-available-on-ai-gateway) Drama 3 availability and preview status.

For future quality comparisons, use Korean sound changes and number/date readings, English minimal pairs and context-dependent words, ordinary sentences, and mixed-language names. Include the app's other supported languages before claiming validated coverage. Native-speaker listening is needed for phonetic certification; ASR transcription alone cannot provide it. Do not ship a known bad fallback or claim perfect pronunciation. Live Korean WAVs have now been generated and decoded, and native browser playback is tested. Native-speaker phonetic certification remains outside automated playback checks.

## Constraints

Preserve all existing translation model, cache, prompt, retry, and telemetry policies. Do not record speech text or audio in Langfuse. Validate and bound speech input, propagate cancellation, and sanitize public errors. Preserve all pending npm migration changes. Implement and validate locally before any push or deployment.

## Verification

Unit-test stream validation, cancellation, audio chunk scheduling, and playback cleanup. Run the full unit suite, typecheck, lint, production build, and browser tests at 382×580 and 594×368. Verify trace artifacts can be replayed. A real speech request, if used for final verification, must be a deliberate small request rather than a regression-test dependency.

## Gateway correction after live testing

The experimental `streamSpeech` WebSocket path failed with a connection-related GatewayResponseError (500). The same model/voice succeeded over the documented HTTPS `generateSpeech` path. Gateway documentation explicitly states that streaming speech output is unsupported. Use HTTPS generation with retries and telemetry disabled; validate the complete WAV, strip its container/provenance metadata, and deliver PCM in bounded chunks. Google detects language from the text and does not support the generic `language` option, so omit that option for Google speech models. Cancellation still aborts pending generation and suppresses any late audio. This changes first-audio latency, not model choice or pronunciation.

## Alternative pronunciation extension

The user requested pronunciation on alternative answers before merging. Reuse the existing Listen/Stop control beside each alternative's Copy action in both sentence and word modes. Speak only the alternative text in the result's target language; never notes or register tags. Offer it only after the complete result validates, apply the same pending/stale/settings reset guards as main pronunciation, and allow only one active speaker across the page. Starting another speaker stops/aborts the previous one. Keep replay caching and deployment model selection unchanged. Use compact paired actions that remain visible on touch screens and keep long text inside its card.
