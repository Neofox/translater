# A: contextual learning inspector

## Approved direction

The user selected Open Design option A on 2026-10-27. The approved chat proposal
and interactive reference are the design basis:
`/Users/3i-a1-2025-005/.codex/visualizations/2026/10/27/01a17bc1-e46c-7802-becd-ff91c4316b9b/translater-learning-exploration.html`.
This document records that direction and the implementation decisions needed to
connect its sample interactions to real, current translations.

## Intent and constraints

- Preserve write/paste → automatic translation → Copy → Clear on every layout.
- Main Copy continues to enable when its JSON string closes. Learning work never
  gates translation, pronunciation, refinements, or copying.
- Keep the shared dark ground and existing violet action / amber learning tokens.
- Keep source left and result right in workspace, split and book modes. Keep the
  compact, editable source below the result in stack/laptop modes.
- Paste and Clear remain adjacent, visibly labelled, and at least 44px high.
- Keep the source textarea node, focus, cursor, native selection, context,
  shortcuts, safe-area behaviour, and incremental visualViewport handling.
- npm only; no new dependencies, model changes, fallback, automatic paid retry,
  new credentials, live billed tests, deployment or merge in this change.

## Approaches considered

A reuses the existing source-side Notes space as a learning inspector. On phones
the same content opens in a nonmodal panel above the composer. The explanation
requires a glance across the desktop panes, but the output remains short.

B expands all breakdown rows beneath the translation. Explanations are next to
the result, but they lengthen the output and displace alternatives. The user chose A.

## Interaction and information hierarchy

The default translation retains its short wording explanation and Copy/Listen.
A quiet, labelled Breakdown action opens the sentence overview. Tapping a phrase
in a complete, current main translation opens that phrase in the same inspector.
Do not add another permanent column or duplicate grammar/dictionary cards.

The overview lists meaningful target-language chunks with their source equivalents
and a short word-order/omission explanation. Phrase detail shows contextual meaning,
base form, literal meaning, natural meaning, grammar and omitted referents where
useful; omit empty facts. A Whole sentence control returns to the overview.
One selected chunk receives amber emphasis in the output and, where an exact
source span is available, in a noninteractive mirror behind the source textarea.
The editable source itself never becomes a lookup trigger or loses its native
selection. Preserve the mirror's font, padding, scroll, wrapping and whitespace.

Use pointer hit testing on the result's rendered text to identify the tapped
offset, then select the model's chunk containing that offset. Do not wrap every
word in a padded button. Ignore drags, long presses, existing selections and
double-click selection gestures. Breakdown plus the inspector's 44px chunk
buttons provides the full keyboard and assistive-technology route. Hover is an
optional hint, never the only entry. Inline highlights preserve the exact output,
including whitespace, punctuation and line breaks.

Existing learning tips, character notes, and word-mode POS/senses/examples/origin/
synonyms move into the shared inspector. Existing synonym lookup still works.
Word mode uses existing dictionary data and does not request a sentence breakdown.
Alternatives keep their explanations, Copy/Listen and open list. Refine becomes
one Adjust disclosure whose summary names active adjustments; applying/removing
chips, limits and failed-refinement rollback retain existing behaviour. UI language
moves into an accessible Settings popover; translation Tone stays visible.

## Responsive learning surface

Workspace/split/book place the inspector under the source, reusing the reference
scroll region and its 44rem maximum measure. Stack/laptop use one dismissible,
nonmodal learning panel between the result region and composer. It has its own
scroll, Whole sentence, minimize and close controls; it never covers the source
actions or main Copy. At short visible heights and keyboard entry, minimize it
to a small labelled restore control; at tight heights collapse that control into
the existing Breakdown entry if necessary. Editing does not automatically reopen
learning. When focus is inside a panel that closes, return focus to a surviving
trigger; never restore it to an unmounted node. No focus trap or background inert.

Do not auto-open learning when a result arrives, while streaming, or on resize.
Clear closes and resets selection immediately, focuses source, and preserves the
existing language/tone/context preferences. Request changes invalidate selected
chunks synchronously. Resizing between layouts retains the selected chunk and
view where space permits without moving source/result between panes.

## On-demand data (implementation decisions)

Use a separate server function and `generateText` + `Output.object` through the
existing AI Gateway and exact `TRANSLATE_MODEL`. Reuse current authentication;
never inspect/log secrets or preflight request authentication from process.env.
The main translation prompt/schema/stream and its cache remain unchanged.

For long or multi-sentence translations, the inspector selects one sentence at
a time, initially the tapped sentence or the first sentence on Breakdown. Expose
previous/next or a sentence picker in the inspector, retaining whole-result Copy.
Use `Intl.Segmenter` and exact UTF-16 offsets with a conservative whole-text fallback.

The learning input includes the original source (max 4,000 chars), the actual
rendered translation (max 16,000 chars), an exact selected sentence range,
source/target language, tone, UI language and optional context (max 1,000 chars).
Reject oversized learning input locally with a small learning-only notice;
translation/copy must remain available. All input text is untrusted data, including
context. Prompts must describe analysis, not obey instructions embedded in it.

Strict required output fields: sentence-level word-order explanation and up to
64 chunks, each with an exact target start/end/text, zero or more exact source
start/end/text spans, contextual gloss, base form, literal meaning, natural
meaning, grammar and omissions. Strings can be empty where not useful. Validate
integer ranges, exact slices, grapheme boundaries and non-overlapping ordered
target chunks in server code. Never accept model offsets that highlight different
text. Many-to-many source correspondence and empty source spans are valid;
source spans may reorder. Preserve unmatched target text as normal text and mark
an incomplete overview as partial rather than inventing coverage. Invalid output
is a learning-only failure with explicit Retry.

One deliberate open/tap can initiate one learning request. No automatic fetch on
translation completion, pointer hover, rerender, or cache eviction. Deduplicate
in-flight requests; page-memory LRU holds at most 20 completed analyses and server
LRU at most 50, keyed by source, actual output, selected sentence, language, tone,
UI language, context, model and prompt version. Never persist conversation text
in localStorage, analytics or logs. Do not cache failures or partial results.

Use maxRetries: 0, a 60-second server timeout, bounded output tokens and request
abort propagation. Pass telemetry.isEnabled: false so globally registered
translation telemetry cannot record learning. Return only validated safe fields;
sanitize provider errors through existing public error classification. Edits,
Clear, language/tone/context/UI-language changes, refinements, errors, unmount
and pagehide abort or invalidate outstanding work. A late response can never
reopen the panel, replace a newer selection, or change a translation action.

## Verification

Use test-first coverage for range validation, Unicode, duplicate/reordered source
spans, sentence selection, request identity, cancellation, stale responses,
cache/deduplication, bounded requests, retries and learning-only errors. Component
tests cover one shared inspector, keyboard access, word data, Adjust, settings,
Clear, native selection, early Copy and completed Listen. Use existing synthetic
browser transports: no provider or speech requests.

Run Chromium/WebKit at 382×580, 580×382, 594×736, 736×594, 1512×982, 1728×1117
and 1488×700. Check default, overview, selected phrase, long result, word,
streaming, error and keyboard shrink/pan states, safe-area insets, source/cursor
continuity, readable whole lines, 44px controls and reachable primary actions.
Finish with unit suite, typecheck, lint, formatting and Node 22+ production build.
Report simulated browser evidence separately from real hardware verification.
