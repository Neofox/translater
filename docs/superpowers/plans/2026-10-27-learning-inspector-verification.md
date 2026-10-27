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

## Learning affordance polish

Removed both instructional helper messages, restored dotted underlines on
completed tappable sentence/word text, and replaced the action-row and
Alternatives-heading dividers with spacing. Existing selection and activation
behaviour is unchanged. Word buttons inherit the underline explicitly.

Verified the running app visually at MacBook dimensions and checked that both
sentence and word text have the underline while the helper messages are absent.
The existing 312 unit tests and 36 Chromium/WebKit MacBook/portrait interaction
checks passed, covering phrase taps, native selection, keyboard entry, Copy and
the compact panel. Typecheck, lint, formatting and production build passed.

## Prepared phrase map and dictionary restoration

The latest user correction supersedes the original on-demand-only/basic-schema
constraint: a lightweight `learningPhrases` map is now generated immediately
after `main` in the same translation response. It contains exact target quotes,
short glosses and corresponding source quotes, with no model-counted offsets.
The server cache/prompt version is bumped, and all sentence few-shot examples
include the new required field. Early main Copy keeps its existing readiness
rule. The map adds some output tokens to the translation request; it does not
start a second automatic model request.

The desktop reference pane shows the prepared overview immediately. Tapping a
marked phrase reveals its basic meaning immediately; only **More detail** starts
enrichment. Old responses without a phrase-map field retain the legacy fallback.
Incomplete or ambiguous prepared maps preserve their provenance and never fall
through to a paid request on tap/navigation. Ordered exact-quote matching resolves
repeated text only when unambiguous, respecting grapheme boundaries.

Only meaningful phrase spans are underlined; spaces/punctuation remain plain.
Selected phrases have one background highlight, without an underline. The
breakdown omits punctuation-only rows while preserving original selection
indices. Word dictionaries again appear automatically in source-side reference
layouts without stealing editor focus; compact layouts still open on tap.

A fresh read-only review found two Important cases. Both were reproduced with
failing tests, fixed, and followed by 320 passing unit tests: uncovered prepared
sentences must not implicitly request enrichment, and a new selection made while
enrichment is pending must survive its completion. No Critical issues were found.

Live verification with synthetic text (`Hello, how are you?`) produced a ready
two-phrase overview without a comma row as part of the translation response.
Browser checks cover immediate prepared meaning, explicit-only enrichment,
native selection, stale replies, word dictionaries and the existing quick loop.
Final evidence: **320/320 unit tests**, **140/140 learning browser checks** across
all 14 Chromium/WebKit viewport configurations (139s), plus passing typecheck,
lint, formatting, diff check and production build. A browser network observation
confirmed **zero server-function requests** from the first prepared-phrase tap.
Physical device gesture behaviour and broad linguistic quality remain outside
this local verification.

## Redundant action and enrichment loading polish

Removed Breakdown from source-side prepared layouts while preserving compact and
legacy entry points. Enrichment now says “Loading more detail…” (with a Korean
equivalent), keeps the prepared meaning visible, and shows three neutral skeleton
fact rows. Placeholder markup is aria-hidden; the loading status remains announced.

Verification: 321 unit tests, typecheck, lint, formatting and production build
passed. Forty MacBook/portrait Chromium/WebKit interaction checks passed; the
prepared-loading scenario additionally holds the synthetic provider response to
verify skeletons and their removal on completion. The screenshot helper was
updated to wait only for finite transitions, excluding the infinite pulse.

## Header adjustments and Open Design release review

Adjust now belongs beside Tone in the header. A muted label/divider separates
persistent tone settings from current-result refinements. Measured chip widths
choose visible controls or one disclosure; the same RefineRow/input remains
mounted across responsive changes. Compact panels reserve header space rather
than covering the translation. Custom has labelled Apply and accessible Close,
both 44px; Close preserves its draft and returns source focus. The open disclosure
has a selected state and active refinements have a dot/summary.

Short heights use a scrolling chip row or the Custom editor alone. A tight
keyboard keeps a single Custom strip, leaving translation, Copy/Listen and the
source Paste/Clear controls visible. Short source-side layouts temporarily
collapse reference notes and allow the composer its full space, avoiding text
and action overlap. Outside dismissal runs after the clicked action; a failing
clipboard regression demonstrated that pointerdown dismissal could swallow Copy.

The native Open Design app reviewed actual-component screenshots in four rounds:

1. Small fixes: separate Adjust from Tone; reserve phone panel space; avoid
   keyboard/composer overlap.
2. Keep: accepted those fixes; recommended visible Custom Apply/Close and open
   trigger state.
3. Accepted desktop, portrait and keyboard; required fixing 580×382 source/actions
   overlap. Suggested selected Custom state as optional polish.
4. **Accept**: “I'm satisfied with the complete design for release, and I have no
   further changes to recommend.” The final landscape screenshot shows both
   source lines above Paste/Clear with no notes peeking underneath.

Open Design reviewed static screenshots, not code or a physical device. Its
acceptance covers the final desktop, portrait, short landscape and emulated
319px keyboard designs. Browser tests cover interactions and layout separately.

A fresh read-only code review found one Important lifecycle case: error/remount
could leave width measurement observing detached controls. A stable-refinements
fixture reproduced it; depending on the error's presence reconnects measurement
on same-sentence Retry. The new browser regression failed before and passed
in Chromium/WebKit after the fix. The legacy context/dictionary test now uses
its intended word fixture rather than seeking a word trigger in a sentence.

Release verification: **322/322 unit tests**, typecheck, lint, formatting,
diff check and production build passed. The complete 910-case Chromium/WebKit
matrix finished with **906 passing** and four instances of the same legacy
context/dictionary harness race: it queried for a disclosure before the native
selection grace period opened the panel. Waiting for the inspector before
querying its controls fixes the harness. The affected test then passed **14/14**
browser/viewport configurations. No product code changed after that full run.
All 182 dedicated learning/adjustment cases passed in the complete matrix.

The matrix spans 382×580, 580×382, 594×736, 736×594, 1512×982, 1728×1117 and
1488×700 in both engines. It covers source/target language menus, safe areas,
keyboard shrink/pan, Copy during streaming, native selection, prepared phrase
maps, on-demand enrichment, dictionary lookup, speech cancellation/replay,
Custom Apply/Close, adaptive draft retention, error/retry and outside-click Copy.
Physical phone hardware remains untested.

## Production verification and combined compact panels

PR #7 merged as `a7ae00a4805fcdacda0f3daffec4461d36f20de2`. Vercel production
`dpl_Edjnkw6TUJs7chezewZHrmMcsdWG` became READY and assigned the existing
production domains, including `translate.jers.dev`. The pushed and merged trees
were identical. The temporary GitHub account switch was restored afterwards.

Live production returned a real sentence translation and prepared phrase map.
A first phrase tap showed its basic meaning with zero same-origin POSTs; explicit
More detail made one successful HTTP 200 request and displayed base form and
grammar. Main Copy confirmed Copied. No credentials or environment values changed.

The live 382×580 check then found an untested combination: an expanded learning
panel plus Custom covered Copy, despite Copy's rectangle remaining within the
viewport. The new regression uses elementFromPoint to verify the button is
actually clickable. Opening compact Adjust now minimizes learning while retaining
the selected phrase; Show learning dismisses Adjust and restores the selection.
Both the original overlap and the reverse restoration race had failing tests
before their fixes. The initial correction passed 196 learning checks across all
14 configurations; the final transition-only change passed all **42 affected browser checks** across
14 configurations, including one-click restoration. Fresh 322 unit tests, typecheck,
lint, formatting, diff check and production build also passed. A WebKit keyboard
assertion now waits for the asynchronous layout state and additionally checks
that Copy stays within the visual viewport.

After the user unlocked the Mac on October 28, Open Design opened both the live
failure and corrected screenshots. Its final verdict was **satisfied for release**:
translation, Copy/Listen, Custom Apply/Close and source Paste/Clear remain visible,
and the minimized learning row preserves the selected phrase. It identified no
release blocker. Its optional suggestion about text scrolling behind pinned
Copy/Listen was left as existing scroll behaviour; no extra divider was added.
The combined-state regression was freshly rerun in Chromium/WebKit portrait:
**2/2 passed**, including one-click learning restoration. The correction is
cleared for release through the normal PR and production deployment workflow.
