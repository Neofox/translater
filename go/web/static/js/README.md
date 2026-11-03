# Client modules

Plain ES modules, no framework or bundler. `app.js` is the entry and imports
the others by unhashed path; the page's import map points those paths at the
hashed, minified files `internal/web/static.go` serves. Tests:
`node --test 'web/static/js/*.test.js'` (from `go/`).

| Module        | Role                                                                                   |
| ------------- | -------------------------------------------------------------------------------------- |
| `app.js`      | State, routing (auto target), runs of `#translate-form`                                 |
| `composer.js` | Debounce/IME/paste/blur/shortcut scheduling, `detectIntent`, `detectLanguage`, `resolveTarget`, warm-up, editor auto-grow (`resize`) |
| `layout.js`   | `decideLayout` (port of `useWorkspaceLayout`), `data-layout`/flags, `--app-height`/`--app-top`/`--workspace-height`, `.output-panel` order, `nt-layout` |
| `context.js`  | Reply context toggle and field (`template#context-field`), `nt.context` sessionStorage, run `context` |
| `stream.js`   | `nt-*` event handling (current run only), grapheme interpolator, error view             |
| `copy.js`     | `requestKey`, Copy/Listen enabling, Copy actions                                         |
| `dictionary.js` | Word dictionary POS tabs (active variant across `#word-meta` swaps), synonym lookup, reference pane placement, word-details trigger state |
| `pcm.js`      | `PcmPlayer`: little-endian PCM16 scheduled on Web Audio (port of `pcmPlayer.ts`)          |
| `speech.js`   | Listen buttons: gesture-bound audio unlock, single page-wide voice, `/speech` stream, replay cache |
| `prefs.js`    | `nt.preferences` cookie, Tone, UI language, chip bars, More listbox (fill, placement)    |
| `listbox.js`  | More listbox keyboard, roving focus, hover focus and typeahead (useListNavigation, useTypeahead) |
| `settings.js` | Settings popover: placement, focus in and back, `aria-controls`, `aria-owns` mirror      |
| `refine.js`   | Refine chips and custom adjustment (`template#adjust-template`), caps, `previousMain`, rollback stack of a failed refine |
| `float.js`    | Fixed popup placement (offset/flip/shift/size, Adjust clearance), `autoUpdate`, `panelBoundary`, `closeOnFocusOut` |

## Language detection

`detectLanguage` keeps the TS app's CJK script counting but does not ship
`tinyld/light` (33 KB gzip, over the 10 KB allowance): any Latin-script text is
`en` until the model's `nt-source-lang` event corrects the Auto label. These
`src/lib/detectLanguage.test.ts` cases are therefore dropped:

- "distinguishes French from English" (`Bonjour, comment ça va aujourd'hui ?` → `fr`)
- "distinguishes Spanish from English" (`Hola, ¿cómo estás hoy? …` → `es`)

Consequence: under Auto source with target English, Latin-script input in
another language (French, Spanish, …) is translated to Korean (the client
sees `en` = target and flips), where the TS app would keep English. This is
accepted: the real use is EN↔KO. The model's `nt-source-lang` then only
relabels the Auto chip; a result's routing stays pinned to its run while the
text is unchanged (`routingDetected`), so its Copy/Listen stay usable and no
second request is made.
