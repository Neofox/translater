# Stable Load and Actions Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans in the current checkout, as selected by the user earlier in this session.

**Goal:** Remove asynchronous control movement during startup and translation.

**Architecture:** One persistent result action group, positioned by CSS pane-width queries. Input actions own composer condensation; SSR-ready header slots and optional font display prevent late jumps.

**Tech Stack:** Existing TanStack Start, React, Tailwind v4, Vitest Browser Mode.

**Spec:** `docs/superpowers/specs/2026-10-28-stable-load-actions-design.md`

## Constraints and review focus

- Keep 44px targets, A's existing palette and saved preferences.
- Copy uses early main readiness; Listen waits for a current complete result.
- Preserve learning fallback, speech errors, text selection and input focus.
- Test narrow wide-pane thresholds with safe-area insets and short keyboard views.
- New CSS must also choose correct server-rendered geometry before hydration.

## Steps

1. Add failing browser regressions for permanent action slots, stable streaming
   geometry and composer size. Extend viewport coverage to iPhone 390×844 and
   844×390. Preserve the existing folded/MacBook matrix.
2. Move one persistent Copy/Listen group outside generated content. Use a named
   result container to place it in the wide header or compact dock. Keep learning
   above the dock, original readiness guards and one speech owner.
3. Condense compact input on the input action and reserve the Adjust header slot.
   Bundle pinned font-face declarations with optional display and attribution.
4. Run focused regressions, unit suite, typecheck/lint/format/build and browser
   matrix. Request independent code review. Share final real-app screenshots with
   Open Design and iterate on meaningful findings.
5. With checks and design review clear, use the user's standing release approval
   to push a PR, merge after deployment checks, and verify the exact production
   commit and startup/control behavior. Restore temporary browser overrides.
