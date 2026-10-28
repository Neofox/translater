# Learn the foreign side of a translation

The UI language represents the user's fluent language, as it already does for
Learning tips. A Korean sentence translated into English with an English UI must
therefore break down the original Korean. English to Korean keeps its Korean
translation breakdown. A Korean UI applies the symmetric rule. If neither side
matches the UI language, or both sides are the same language, preserve target
breakdowns.

Choose the side from the completed result's reported languages and the current
UI language. Generate the basic map for that side in the existing translation
request. Phrase text quotes the analysed side exactly; the legacy `sourceTexts`
name holds opposite-side quotations. Do not reverse input/translation fields:
their 4,000/16,000 character limits still describe the real original/output.

Detailed analysis accepts an optional `side`; legacy omitted side means target.
Sentence segmentation, exact quote resolution, grapheme validation, cache identity
and prompt selection all use that side. Explanations remain in the UI language.
Only deliberate More detail starts enrichment. Cache/prompt versions change to
avoid restoring target-only maps for source-side learning.

Keep the existing learning surfaces. Source-side learning shows original-language
chunk buttons and highlights the chosen original range through the inert textarea
mirror. The native-language translation remains plain with Copy/Listen. The source
textarea remains editable, with the same node, cursor and native selection rules.
No additional source click gesture or panel is introduced.

Regression coverage includes both UI languages, auto/explicit source selection,
legacy target analysis, short translations with longer original sentences,
opposite-side correspondence, no automatic enrichment, source highlights and
unchanged Copy/Clear controls. Provider text, credentials and raw errors remain
outside logging/telemetry.

## Verification

The new side-selection, source-range and prompt regressions failed before the
implementation. The complete unit suite then passed 336 tests. All 224 learning
browser checks passed across Chromium/WebKit at seven sizes. A read-only review
found no Important/Critical issue and one minor screen-reader language mismatch
on the selected phrase heading; that was reproduced and corrected. The final
source-learning cases, including English/Korean UI symmetry and the heading
language, passed eight MacBook/portrait checks. Typecheck, lint, formatting and
production build passed. The browser tests also assert prepared meaning makes no
automatic enrichment request, More detail carries the correct source-side
snapshot, the original textarea value remains unchanged and Copy/Clear stay
reachable. Physical device gestures remain outside browser emulation.
