# Stable startup and result actions

Keep approved A and the fast write/paste → translation → copy → clear loop.
The user requested an audit on MacBook and iPhone and delegated placement review
to Open Design, retaining their earlier instruction to iterate together and
release when satisfied.

## Approaches

Open Design reviewed five actual-app screenshots. A universal header would
remove phone language shortcuts and put Copy far from Paste/Clear. A reserved
top action row costs height without improving thumb reach. Its recommendation,
adopted as the placement decision for this small refinement, is a hybrid:

- Wide result panes: labelled Copy/Listen at the right of the language header.
- Compact panes: a fixed, in-layout action dock below the result scroll area,
  above the composer. Preserve the language row and 44px icon targets.

Use pane width, not device names. The implementation threshold is 600px so two
112px labelled actions and a usable language selector fit with safe areas.
The same button nodes exist in empty, pending, streaming, complete and error
states. Copy keeps its early-main readiness rule; Listen waits for completion.
Errors and stale results disable both. The learning panel belongs above the
compact dock, so it cannot cover the primary controls.

## Other observed shifts

The phone composer currently collapses on asynchronous main readiness. Instead,
condense a nonempty compact turn during its input action; explicit expansion,
context editing and input warnings remain authoritative. Preserve textarea node,
selection and focus. Keep the header's adjustment slot reserved even when no
sentence is present, so Tone/Settings do not move when Adjust appears.

The downloaded font changes header control positions by about 5px. Bundle its
pinned font-face CSS with optional display, preserving the existing subset URLs
and license. Slow downloads use the existing system fallback for that visit
instead of a late swap. No new typeface or palette.

## Verification

Measure controls from empty through streamed short/long/word results and errors;
check Copy/Listen identity, geometry, stale guards and hit tests. Compare raw SSR
and hydrated geometry, saved preferences, font delay, safe areas, iPhone portrait
and landscape, MacBook sizes, keyboard and learning/Custom combinations. Use
synthetic provider fixtures. Send updated screenshots to Open Design, address
actionable feedback and obtain its final release verdict before the authorized
push and production deployment. Browser emulation does not prove physical-device
behavior.
