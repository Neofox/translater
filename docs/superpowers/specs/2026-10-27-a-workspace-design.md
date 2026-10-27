# A workspace baseline

The user approved returning to concept A (Refined workspace), retaining fast
Paste/Clear, early main Copy and the Safari keyboard fixes. The visual reference
is `translater-concepts.html`, direction A, in this chat's visualization folder.

## Accepted design

- MacBooks use a full-height source pane on the left and a contained result pane
  on the right. Source languages sit above a transparent editor; Paste/Clear and
  reply context stay at its footer. Use A's violet/amber palette and type scale.
- The result follows one reading column: language controls, main translation,
  Copy/Listen, refinements, alternatives, wording/usage and learning details.
  Keep alternatives open and retain desktop open details, without count badges,
  redundant formality prose or a focus ring on the result surface.
- Folded and unfolded portrait retain the result-first compact source bar once
  the main result is ready. Phone actions remain 44px icon controls. Unfolded
  landscape retains its stable two-pane arrangement through keyboard changes.
- Keep the measured visual-viewport height, pan offset, incremental keyboard
  baseline, safe-area spacing, focus/selection preservation and current-result
  guards. Keep optional physical book/laptop layouts.

## Approach

Return desktop structure to A rather than restyling the C top-composer grid.
Keep the existing responsive/translation state machinery. Add an explicit
`workspace` layout mode for the desktop arrangement so it cannot accidentally
inherit the phone split's reversed order or inner safe-area edges. Remove the
obsolete desktop C grid/card overrides. Preserve the functional phone fixes
instead of restoring the original prototype's oversized source area.

## Constraints and acceptance

Use npm. No dependency, model, provider, telemetry or paid API changes. Validate
1512×982, 1728×1117, 1488×700, 382×580, 580×382, 594×736 and 736×594, plus simulated
keyboard shrink/pan and nonzero safe insets. Main Copy must activate when the
current main string closes; Paste/Clear/context must remain reachable. Check
short, word, long, streaming, error and empty states. Update PR6; do not merge.
