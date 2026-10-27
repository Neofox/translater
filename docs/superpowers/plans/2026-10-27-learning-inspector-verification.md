# Contextual learning inspector verification

Implemented approved Open Design option A on `feature/learning-inspector`, in the
existing checkout. No dependencies, credentials, model selection, deployment or
translation-stream contract changed.

## Behaviour

- A deliberate tap on a completed sentence translation opens its phrase details.
  Breakdown opens the sentence overview; chunks and sentence navigation are
  keyboard accessible. Native selection, double-click and long press stay native.
- Details include contextual meaning, base form, literal/natural meaning,
  grammar and implicit words when relevant. Exact validated source spans highlight
  in a mirror without replacing the source textarea or changing its cursor.
- Desktop/split layouts use the source reference area. Compact layouts use a
  nonmodal panel above the composer. Tight heights use result scrolling, with
  Copy pinned and the source composer outside that scroll.
- Adjust contains the existing refinements, including active summaries and errors.
  Settings contains UI language; Tone stays in the header. Alternatives remain open.
- Learning is requested only by deliberate interaction, independently of the main
  translation. Completed analyses use bounded memory caches. Errors require
  explicit Retry. Edits, settings, Clear and pagehide invalidate pending work.

## Verification

- Full unit suite: **308/308**, 36 files.
- Typecheck, ESLint, Prettier and `git diff --check`: passed.
- Production build: passed on Node 26.5.0. Existing dependency `use client`
  bundling warnings remain. The learning provider implementation is in a server
  chunk and absent from generated client JavaScript.
- Complete browser matrix before final review fixes: **798/798**, 28 files,
  Chromium/WebKit at seven sizes: 382×580, 580×382, 594×736, 736×594,
  1512×982, 1728×1117 and 1488×700.
- After review fixes, all learning browser tests passed: **112/112**, 14 files,
  across the same Chromium/WebKit viewport matrix (100s). Targeted legacy
  Chromium/WebKit portrait regressions also passed: **48/48** (56 unrelated
  cases excluded by the name filter), including early Copy, native editing,
  dictionary content, keyboard shrink/pan and safe-area controls.
- Browser learning/speech transports are fail-closed aliases. No live provider
  calls ran. Browser fixtures exercise real learning state, rendering and layout.
- Visual inspection covered desktop, normal portrait and 320px short portrait.
  Scenarios include long results, incremental visual viewport shrink and pan,
  safe-area insets, early Copy, source focus/cursor, retry, cached sentence races,
  late responses, selection, double-click and long press.

## Final review

One fresh reviewer found five Important issues. Each had a failing regression
test before its fix, followed by a green full unit suite:

1. Returning to a cached sentence now cancels another sentence's pending request.
2. Returning to a failed sentence restores that sentence's error and Retry.
3. Pending phrase-tap timers cancel on pagehide and request identity changes,
   even when the wording is unchanged.
4. Learning can deliberately reopen in short windows; tight windows use the
   result scroll while keeping primary controls reachable.
5. A click dismissing an existing native text selection does not inspect it.

The final browser selection test explicitly clears any prior collapsed range
before creating its selection; `Selection.addRange` otherwise ignored the new
range in sequential runs. It asserts selection is present at pointerdown.

No Critical or deferred Minor findings. No second review was dispatched.

## Decisions and limits

- Existing exact `TRANSLATE_MODEL` and Gateway credentials were reused, as
  approved. Existing deployment authentication remains required.
- Work stayed in the current checkout on a feature branch, as approved;
  concurrent edits require coordination.
- The complete browser run followed toolbar integration, avoiding a duplicate
  full run. Its layout findings were fixed before completion. Review fixes are
  covered by the affected reruns rather than claiming a second full-matrix run.
- Tight-height analysis requires scrolling the result. This preserves readable
  learning content and access to the fast translation loop.
- Live linguistic quality was not evaluated with billed calls. Real-device
  keyboard/gesture behaviour remains bounded by Chromium/WebKit emulation.
- Deployment activation/authentication was not tested; no deployment was made.
- The local development shell returns HTTP 200 at `http://localhost:3000/`.
  Vite reports the existing `.env.local` Gateway OIDC token expired; no API-key
  fallback is configured. Live local translation needs the existing token
  refreshed. No credentials were modified and no live request was attempted.

Only formatter changes were made to `.cta.json` and `prettier.config.js` to pass
the existing global formatting check; parsed `.cta.json` content is unchanged.
Ignored execution scratch is excluded from Prettier.

## MacBook follow-up fix

After the user refreshed local authentication, live verification reproduced a
breakdown failure: model-generated offsets miscounted whitespace and source
positions. The server now resolves unique exact quotations in code before the
unchanged strict slice/grapheme/order validation. Correct offsets can still
disambiguate repeated text. Ambiguous source correspondence is omitted, while
unresolved target chunks fail safely. No automatic retry or credential change.

The translated word itself now opens dictionary details with click or keyboard
activation. The duplicate Word details label/button row was removed. Desktop
reveals the existing dictionary in the source pane and focuses its heading;
compact panels restore focus to the word on close. This uses existing word data
and makes no learning provider call.

Verified in the running local app at 1512×982 with the configured live model:
sentence overview, direct phrase click, phrase details and matching source
highlight; also direct word click revealing real dictionary data. The browser's
temporary viewport override was reset afterwards. Live test text was synthetic;
no provider bodies, credentials or generated analysis were logged.

Regression evidence: 312 unit tests pass. An affected Chromium/WebKit run at
MacBook and portrait sizes passed 24 checks, including dictionary synonyms,
native phrase taps, early Copy and direct word activation. All 112 existing
learning checks passed across the 14 browser/viewport configurations. The new
word check initially had four landscape failures because it incorrectly expected
a stacked-panel Close button in split layouts; it now branches on the rendered
reference panel. Its final rerun passed all 14 configurations, including native
Enter activation and compact close-focus restoration. No product change was
needed for those four harness failures.

Final typecheck, lint, formatting, diff check and production build passed. The
learning provider remained absent from client JavaScript (one server chunk).
