# Approved A: aligned workspace

The user approved Open Design's A in `translater-ux-a-paired.html` on 2026-10-27. This refines the existing source/reference implementation on PR 6.

- At every side-by-side size, source stays left and result stays right before, during and after keyboard changes. Portrait keeps its compact editable source below the result.
- Both panes share the #171821 ground, equal gutters, aligned language toolbars and the same control system. The source text and its Paste/Clear/context footer form the only raised field.
- Main translation and its wording reason (word usage in dictionary mode) read together on the right. The rationale is visible without an accordion and does not appear in left notes. Alternatives remain open, with explanations and icon Copy/Listen beside each row.
- Learning tips and source dictionary metadata stay left in side-by-side layouts; in portrait they follow the result and alternatives.
- Copy and Listen share a 44px height, 112px desktop width and 44px compact width. No visible shortcut hint. Preserve actual keyboard shortcuts.
- Preserve early Copy as soon as the current main translation is available, speech completion/staleness guards, immediate paste, Clear focus/context retention and Safari visual viewport, insets, cursor and keyboard handling.
- Use npm. No provider/prompt/dependency changes, sample actions, em dashes, target focus ring or paid validation calls.

Reference: `/Users/3i-a1-2025-005/.codex/visualizations/2026/10/26/01a176ec-6304-7781-95dc-0c4bba82ed47/translater-ux-a-paired.html`.

Validate Chromium/WebKit at 382x580, 580x382, 594x736, 736x594, 1512x982, 1728x1117 and 1488x700. Compare short/alternatives, long and word renders with the approved design, plus keyboard and safe inset checks. Real Safari hardware remains a user verification step.
