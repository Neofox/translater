# Client modules

Plain ES modules, no framework or bundler. `app.js` is the entry and imports
the others by unhashed path; the page's import map points those paths at the
hashed, minified files `internal/web/static.go` serves. Tests:
`node --test 'web/static/js/*.test.js'` (from `go/`).

| Module        | Role                                                                                   |
| ------------- | -------------------------------------------------------------------------------------- |
| `app.js`      | State, routing (auto target), runs of `#translate-form`                                 |
| `composer.js` | Debounce/IME/paste/blur/shortcut scheduling, `detectIntent`, `detectLanguage`, `resolveTarget`, warm-up |
| `stream.js`   | `nt-*` event handling (current run only), grapheme interpolator, error view             |
| `copy.js`     | `requestKey`, Copy/Listen enabling, Copy actions                                         |
| `prefs.js`    | `nt.preferences` cookie, Tone, UI language, chip bars, More listbox, Settings popover    |

## Language detection

`detectLanguage` keeps the TS app's CJK script counting but does not ship
`tinyld/light` (33 KB gzip, over the 10 KB allowance): any Latin-script text is
`en` until the model's `nt-source-lang` event corrects the Auto label. These
`src/lib/detectLanguage.test.ts` cases are therefore dropped:

- "distinguishes French from English" (`Bonjour, comment ça va aujourd'hui ?` → `fr`)
- "distinguishes Spanish from English" (`Hola, ¿cómo estás hoy? …` → `es`)

Consequence: with Auto source and target English, French or Spanish input is
routed to Korean (the client sees `en` = target and flips), where the TS app
would keep English.
