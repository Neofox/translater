# Approved C translator design

The user approved the Open Design C prototype and requested implementation on
2026-10-26, with no focus ring on the target text field. The visual reference is
`translater-c-desktop-polish.html` in this chat's exported visualizations.

## Intent and scope

Make repeated conversations fast: paste or type, read the automatic translation,
copy, clear, repeat. Preserve real translation, speech, language detection,
context persistence, refinements, streaming provenance, and bilingual UI.
No prototype fixtures, simulated speech, review controls, or paid test requests
belong in production.

## Approved behavior

- C is the single production design. Desktop uses a centered source composer
  above a result area with a comfortable text measure and roughly 30px result.
- Desktop composer has one neutral frame containing language header, auto-sized
  editable body, and labelled Paste/Clear/context footer. Short input occupies
  one line; long input grows to a cap and scrolls internally. Leave deliberate
  space before the target language controls.
- Paste and Clear remain available for nonempty and empty input. Clear focuses
  the input, clears the current result/refinements, and preserves context/tone.
- Copy and Listen sit immediately after the main result. Retain stale/pending
  speech guards and a clear Copy label. Prevent copying an obsolete result.
- Phones prioritize the result above the compact source composer. Short
  landscape windows may split result/source horizontally. Keep the primary
  actions reachable with the software keyboard open.
- Book posture uses separate horizontal segments for source/result; laptop
  posture places result above input, clearing the hinge and safe areas.
- On desktop, Why this wording and Learning tips have static headings and stay
  open. Short-input alternatives occupy the adjacent column. With no
  alternatives, explanation and learning tips each use a column; a lone section
  spans the width. Compact layouts use accessible disclosures.
- Put rationale/formality explanations in Why this wording, not a redundant
  full-width sentence in the main result. Retain dictionary/source metadata and
  synonym lookup. No numeric badges beside Alternatives or Learning tips.
- Text-panel wrappers have no focus ring. Buttons/menus retain visible keyboard
  focus. Respect reduced motion, logical reading order and 44px primary targets.
- Retain the violet action / amber learning palette and existing components.

## Approaches and decision

A refined split workspace, a light editorial version, and C result-first were
prototyped. The user chose C on phone and MacBook, then approved the desktop
composer and information-layout refinements above. Browser testing covers
representative CSS sizes, not a claim of physical Duo hardware testing.

## Engineering decisions

Use the existing React/TanStack/Tailwind stack and npm. Keep server code and
dependencies unchanged. Derive responsive order from actual workspace/visual
viewport size and fold media queries; use keyed panels so edits survive layout
changes. Extract a reusable workspace for production and browser fixtures.

Verify Chromium/WebKit at the existing small sizes, unfolded portrait/landscape,
both MacBook working sizes and a short desktop, including 300-character input,
keyboard-height changes, streaming completion/error, word mode and speech.
