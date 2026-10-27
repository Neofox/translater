# Contextual Learning Inspector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Implement approved option A, with real phrase inspection and sentence breakdown while preserving the quick translation loop.

**Architecture:** A separate on-demand learning service analyses one sentence of an existing result. A page-scoped learning provider manages request identity, completed analysis cache and selection; one inspector appears in the existing source reference region or a compact nonmodal panel. The translation stream and speech remain independent.

**Tech Stack:** Existing React 19, TanStack Start, AI SDK 7, Zod, Tailwind 4, Floating UI, Vitest/Playwright; npm, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-27-learning-inspector-design.md`

## Global Constraints

- Preserve write/paste → automatic translation → Copy → Clear on every layout.
- Main Copy continues to enable when its JSON string closes. Learning work never gates translation, pronunciation, refinements, or copying.
- Keep the shared dark ground and existing violet action / amber learning tokens.
- Keep source left and result right in workspace, split and book modes. Keep the compact, editable source below the result in stack/laptop modes.
- Paste and Clear remain adjacent, visibly labelled, and at least 44px high.
- Keep the source textarea node, focus, cursor, native selection, context, shortcuts, safe-area behaviour, and incremental visualViewport handling.
- npm only; no new dependencies, model changes, fallback, automatic paid retry, new credentials, live billed tests, deployment or merge in this change.

## Review Focus

- Emoji, combining marks, repeated words, reordered source spans and unmatched output must never highlight different text.
- Editing, refinement rollback, Clear, settings and delayed learning responses must not reopen stale learning or change Copy provenance.
- Native text selection, double-click and touch long press must not launch paid requests or change source focus.
- Long translations with incremental keyboard shrink/pan and nonzero safe insets must keep main Copy and labelled Paste/Clear reachable.
- StrictMode replay, simultaneous taps and failures must not duplicate billed requests, cache failure, or automatically retry.

---

### Task 1: Validated learning contract and on-demand service

**Files:** Create `src/server/learningTypes.ts`, `src/server/learningPrompts.ts`, `src/server/learning.ts`, `src/server/learning.server.ts`, `src/server/learning.test.ts`, `src/lib/learningRanges.ts`, `src/lib/learningRanges.test.ts`. Reuse `src/server/gateway.ts`, `cache.ts`, and public translation error classification without changing the translation pipeline.

**Interfaces:**

- `LearningInput`: Zod schema for `text`, `translation`, `sentenceStart`, `sentenceEnd`, `source`, `target`, `mode`, `uiLang`, `context`; limits and range validation from spec.
- `LearningChunk`: `{ start, end, text, sourceSpans: { start, end, text }[], gloss, baseForm, literalMeaning, naturalMeaning, grammar, omissions }`.
- `LearningResult`: `{ wordOrder: string, chunks: LearningChunk[], partial: boolean }`; `partial` derived by validation rather than trusted to the model.
- `validateLearningResult(input: LearningInputData, output: unknown): LearningResult` rejects malformed spans and preserves safe many-to-many correspondence.
- `sentenceRanges(text: string, language: string): { start: number; end: number }[]`; offsets refer to unmodified output.
- `learn({ data: LearningInputData }): Promise<LearningResult>` thin server function; `handleLearning(data, signal, dependencies?)` testable provider boundary with injected generation/cache.

- [x] Write failing tests with literal Korean/English fixtures for exact ranges, reordered/multiple source spans, empty correspondence, emoji/combining boundaries, repeated words, overlaps, out-of-bounds ranges and partial coverage. Assert preserved original text, correct spans or rejection; do not compute expectations with production helpers.
- [x] Run `npm test -- src/lib/learningRanges.test.ts src/server/learning.test.ts`; observe the intended missing-behaviour failures.
- [x] Implement schemas, sentence selection, span validation and the thin server-only boundary. Treat selected sentence offsets as offsets in the complete target string throughout.
- [x] Write failing provider-boundary tests for no retry, timeout/abort, disabled telemetry, cache key isolation, invalid output rejection, sanitized errors and failure not cached. Fake only the external generator; exercise real parsing/prompt construction.
- [x] Implement one exact configured model call using installed-version `generateText`/`Output.object`; maxRetries 0, timeout 60s, bounded output and explicit telemetry suppression. Use source/context as delimited data. Reuse existing Gateway auth/options and 50-entry LRU. No live requests.
- [x] Re-run focused tests and `npm run typecheck`; commit this independently testable service and its contract.

### Task 2: Learning state and safe phrase selection

**Files:** Create `src/context/LearningContext.tsx`, `src/hooks/useLearning.ts`, `src/hooks/useLearning.test.tsx`, `src/components/InspectableTranslation.tsx`, `src/components/InspectableTranslation.test.tsx`, `src/lib/phrasePointer.ts`, `src/lib/phrasePointer.test.ts`. Modify `src/components/TranslatorWorkspace.tsx`, `src/components/OutputPanel.tsx`, `src/components/InputPanel.tsx`, `src/lib/i18n.ts`.

**Interfaces:**

- `useLearning({ snapshot: LearningInputData | null, requestKey: string | null, enabled: boolean })` returns `status`, `result`, `error`, `openAt(offset?: number)`, `retry()`, `close()`, `selectChunk(index: number | null)`, `selectSentence(index: number)`, `selectedChunk`, `selectedSentence`, `isOpen`, `minimized`, `setMinimized(value: boolean)`.
- `LearningProvider` supplies the one shared hook instance to workspace children; derive current snapshot from `TranslatorContext`, `mainText`, `resultIsCurrent` and the existing request key. Disable for word, incomplete, pending/stale and failed results.
- `InspectableTranslation({ text, language, disabled, chunks, selectedChunk, onInspect })` preserves exact text and native selection; emits an absolute target offset for a deliberate tap only. Keyboard access is via Breakdown and the inspector list, not dozens of word buttons.

- [x] Add failing hook tests proving no call on render/result completion, one call on deliberate open, deduplication under StrictMode/rapid taps, cache reuse, explicit-only Retry, learning-only failure, and stale response rejection on every request dimension.
- [x] Add failing pointer/range tests for drag, long press, double-click and noncollapsed selection causing zero inspection, plus a real single tap selecting the containing phrase and emoji-safe offsets.
- [x] Run the focused tests to verify RED, then implement request lifecycle with synchronous request-key guards, abort/pagehide cleanup and a 20-entry completed-only page cache. Layout changes must not initiate requests. Cancel stale work without touching translation/speech state.
- [x] Integrate completed-result tapping and the labelled Breakdown action. Loading/errors render only in learning UI. Before result completion, keep plain urgent streaming text and existing early Copy behaviour.
- [x] Add the noninteractive exact-source highlight mirror; keep the textarea element/cursor and scroll alignment. Empty/ambiguous correspondence produces no source highlight.
- [x] Add integration assertions that phrase selection never calls source `setInput`, a failing learning request leaves main Copy/Listen intact, and Clear closes learning before a late response.
- [x] Run focused tests, existing OutputPanel/context tests and typecheck; commit state and result interaction.

### Task 3: Shared inspector and responsive layout

**Files:** Create `src/components/LearningInspector.tsx`, `src/components/LearningPanel.tsx`, `src/components/LearningInspector.test.tsx`. Modify `src/components/ReferencePanel.tsx`, `TranslatorWorkspace.tsx`, `SentenceView.tsx`, `WordView.tsx`, `InputPanel.tsx`, `OutputPanel.tsx`, `src/styles.css`, `src/lib/i18n.ts`.

**Interfaces:**

- `LearningInspector` consumes shared learning state and current existing learning tips/dictionary data; renders sentence overview, selected phrase detail, sentence navigation, loading/error/retry and Whole sentence.
- `LearningPanel` owns responsive containment and minimize/close/restore controls, not request fetching. Reuse the existing WorkspaceLayout context; never replace the source editor node.

- [x] Write failing component tests for exact chunk labels, selection/detail/back, empty facts, sentence changes, word-only dictionary with zero learning calls, no duplicate tips, keyboard operation, and focus restored from a closed panel.
- [x] Implement a single inspector content tree per active layout: source reference scroll on workspace/split/book; separate nonmodal grid region above the composer on stack/laptop. Keep primary actions outside the learning scroll surface.
- [x] Minimize learning at keyboard/short-height transitions; for tight heights use the existing Breakdown entry as restore rather than reserving another rail. Respect viewport offsets/insets and reduced motion.
- [x] Preserve alternatives as an open list and short rationale with its result. Remove duplicate reference rendering in result views while retaining existing word synonyms lookup.
- [x] Run component tests and typecheck; inspect the seven representative sizes using local fixture data; commit inspector/layout.

### Task 4: Adjust disclosure and Settings

**Files:** Create `src/components/AdjustMenu.tsx`, `src/components/SettingsMenu.tsx` and focused component tests. Modify `src/components/RefineRow.tsx`, `RefineRow.test.tsx`, `OutputPanel.tsx`, `TranslatorWorkspace.tsx`, `UiLangToggle.tsx`, `src/styles.css`, `src/lib/i18n.ts`.

**Interfaces:**

- `AdjustMenu` wraps existing `RefineRow`; its summary exposes current active adjustment labels and any refinement error, even collapsed.
- `SettingsMenu` hosts existing UI-language controls using Floating UI placement/focus/dismissal. Tone remains in the header.

- [x] Write failing tests for active chips/custom adjustment reflected in summary, toggle-off rerun, cap/custom constraints, rollback error discoverability, preserved free-text draft when collapsed, Clear reset, and no refine actions before current result completion.
- [x] Implement the disclosure around the real existing refinement actions; preserve test IDs and model-facing instruction strings. Avoid unmounting focused custom fields without focus restoration.
- [x] Write failing tests for settings keyboard open/dismiss, language persistence, focus restoration and invalidation of active learning on UI-language change; then implement Settings with existing primitives.
- [x] Run focused refinement/settings/context tests and typecheck; commit the toolbar cleanup.

### Task 5: Browser regression matrix and final review

**Files:** Create `tests/browser/learningTransport.ts`, `tests/browser/learning.browser.tsx`; modify `vitest.browser.config.ts`, existing browser fixture helpers and affected assertions in `tests/browser/mobile.browser.tsx`. Update `AGENTS.md` with new boundaries/selectors and the final verification notes.

- [x] Alias learning transport in the browser config so provider requests are impossible. Supply valid static chunks, a controllable delayed response and a learning-only failure through the real client hook.
- [x] Add browser tests for deliberate tap → highlighted phrase → overview, selected source mirror, native drag/double-click/long-press selection, no lookup while typing, no stale reopen after edit/Clear/settings, explicit Retry and early Copy while notes/learning are unavailable.
- [x] Add layout checks for each configured Chromium/WebKit viewport: 382×580, 580×382, 594×736, 736×594, 1512×982, 1728×1117, 1488×700. Cover short/long/word/streaming and keyboard incremental shrink/pan, safe insets and long results with Copy reachable. Include selected phrase and overview screenshots.
- [x] Run `npm test`, `npm run typecheck`, `npm run lint`, `npm run format`, `npm run test:browser`, and a Node 22+ `npm run build`. Fix actual failures; do not replace semantic assertions with source-text checks.
- [x] Perform one fresh whole-branch review against spec and five Review Focus items. Fix actionable findings and rerun affected checks only.
- [x] Confirm generated server-only provider code stays out of the client bundle, no text is persisted/logged and no live paid calls ran. Record exact verification evidence and device-emulation limits.
- [x] Commit verified changes and report the resulting branch/commit, changed behaviour and any remaining limitation. Do not deploy/merge or change credentials.

## Plan self-review

The service, state, UI and toolbar tasks cover each design section. Review Focus
items have explicit tests in Tasks 1, 2, 4 and 5. All offsets use UTF-16 positions
in the full unmodified target/source strings. The one provider/hook boundary is
shared by all surfaces; no UI layout mounts may trigger billed work.
