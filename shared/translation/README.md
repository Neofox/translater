# shared/translation

The language-neutral translation contract. Everything the model sees (prompt
wording, few-shots, result schemas) plus UI strings, languages, limits,
preference rules and golden request bodies. The TypeScript app
(`src/server/prompts.ts`, `schemas.ts`, `src/lib/*`) and the Go app
(`go/internal/contract/data/`, a `go generate` copy) both consume these files
and must produce **identical** OpenAI request bodies.

| Path | Contents |
| --- | --- |
| `prompts/*.mustache` | Every prompt text (see [Templates](#templates)) |
| `prompts/variants/*.mustache` | Eval-only alternative sentence system messages |
| `fewshots/*.json` | `{ "user": string, "assistant": object }` example pairs |
| `schemas/sentence.json`, `schemas/word.json` | Strict result JSON Schemas, sent verbatim as `text.format.schema`. Descriptions are prompt text. |
| `i18n/strings.json` | UI strings, `{ en: {...}, ko: {...} }`, same keys in both |
| `languages.json` | `[{ code, label, promptName }]`; `promptName` is used in prompts |
| `limits.json` | Input limits (characters are UTF-16 code units, JS `length`). `maxLearningTranslationChars` mirrors the `maxLength` already in `schemas/sentence.json` and is used only by the TypeScript learning code. |
| `preferences.json` | `nt.preferences` cookie: `cookie` (name), `version`, `maxAgeSeconds`, `maxCookieLength` (max raw length) and `rules` (each rule's `values`; rule order = cookie field order). Each rule's `storage`/`raw` belong to the TypeScript app's legacy localStorage migration only; the Go app ignores them. |
| `meta.json` | `cacheVersion` (cache keys, `prompt_cache_key`) and `defaultModel` |
| `fixtures/requests.json` | Golden request bodies: `[{ name, input, config, body }]` |
| `fixtures/variants.json` | Same for eval variants, plus `variant` |

## Changing anything here

- Fixtures are the safety net: never hand-edit them. A refactor must keep
  `src/server/sharedPrompts.test.ts` (and the Go equivalent) green.
- A deliberate change to prompt text, few-shots or schemas: edit the files,
  bump `meta.json` `cacheVersion`, run `npm run shared:generate`, then
  `npm run fixtures:capture` and review the fixture diff, then
  `cd go && go generate ./...`.
- After editing any file here run `npm run shared:generate` (TS views:
  `src/server/promptTemplates.generated.json`,
  `src/server/resultTypes.generated.ts`) and `go generate ./...` in `go/`.
  Tests fail while either copy is stale.
- Keep JSON files formatted exactly as `JSON.stringify(value, null, 2)` plus a
  final newline (two-space indent, non-ASCII characters literal, no
  `\uXXXX` except where JSON requires it). A test enforces this for few-shots.

## Rendering

Both apps use a maintained Mustache implementation (JS `mustache` 4.2.0,
Go `github.com/cbroglie/mustache`) with these rules:

1. **No HTML escaping.** `{{name}}` inserts the value verbatim (JS:
   `{ escape: s => s }`; Go: disable escaping / use the unescaped renderer).
   Templates never use `{{{ }}}` or `{{& }}`.
2. **Partials** are the other templates, by name. A template's name is its path
   below `prompts/` without `.mustache`, `/`-separated (`sentence-system`,
   `detail-guidance`, `variants/lean`).
3. **Strip exactly one trailing `\n`** from the rendered top-level result.
   Every template file ends with a single newline; that newline is not part
   of the text. Partials are inserted with their trailing newline (so a
   standalone `{{> p}}` line yields the partial's lines). Standalone tags
   inside a partial are removed within the partial too: `detail-guidance`
   starts with a standalone comment line that contributes nothing, so its
   rendered text starts directly with `The user reads …`.
4. **Standalone tags** (spec behaviour): a line containing only a section
   open/close (`{{#x}}`, `{{^x}}`, `{{/x}}`), a comment (`{{! … }}`) or a
   partial (`{{> p}}`), plus surrounding whitespace, is removed together with
   its newline. Variables (`{{x}}`) are never standalone: a line containing
   only `{{toneGuidance}}` stays a line.
5. Only variables, sections, inverted sections, comments and partials are
   used. No lambdas, dotted names, set-delimiters, or list iteration. Every
   variable in the view is always present (string or boolean); sections are
   used only with booleans.
6. Partials are indented nowhere (all partial tags start in column 0), so no
   indentation propagation applies.

## Variables

Inputs (validated request fields): `source` (`auto|en|ko|ja|fr|es|zh`),
`target` (`en|ko|ja|fr|es|zh`), `mode` (`friends|casual|professional`),
`uiLang` (`en|ko`), `intent` (`sentence|word`). Equality is exact string
equality. `promptName(code)` = `promptName` of the `languages.json` entry with
that `code`, or `code` itself when there is none.

| Name | Type | Definition |
| --- | --- | --- |
| `source` | string | `source` |
| `target` | string | `target` |
| `uiLang` | string | `uiLang` |
| `sourceName` | string | `promptName(source)` (`auto` → `the auto-detected source language`) |
| `targetName` | string | `promptName(target)` |
| `uiLangName` | string | `promptName(uiLang)` (`English` / `Korean`) |
| `metaLang` | string | `uiLang == "ko" ? "KOREAN" : "ENGLISH"` |
| `uiKo` | bool | `uiLang == "ko"` |
| `isPolish` | bool | `source == target` |
| `kr` | bool | `source == "ko" \|\| target == "ko"` |
| `autoSource` | bool | `source == "auto"` |
| `intentSentence` | bool | `intent == "sentence"` |
| `modeFriends` | bool | `mode == "friends"` |
| `modeCasual` | bool | `mode == "casual"` |
| `modeProfessional` | bool | `mode == "professional"` |
| `modeUpper` | string | `mode` in ASCII upper case (`FRIENDS`, `CASUAL`, `PROFESSIONAL`) |
| `populateFormalityNote` | bool | `kr && target == "ko" && mode != "friends"` |
| `detailReminder` | bool | `pairInvolvesForeign && !isPolish`, where `pairInvolvesForeign = (source != "en" && source != "auto") \|\| target != "en"` |
| `manyAlternatives` | bool | `kr \|\| target == "ja"` (word intent only) |
| `toneGuidance` | string | **derived**: `render("tone", view)` |
| `koreanRegisterGuidance` | string | **derived**: `render("korean-register", view)` |
| `wordBand` | string | **derived**: `render("word-band", view)` |
| `leanCharacters` | bool | eval variant only: `true` for `lean`, `false` for `lean-nochars` |

Derived strings are computed after the flags above, by rendering their
templates with the view built so far (rules 1–4 apply, including stripping
the trailing newline), then added to the view. They are single lines.
(`isReading` is not a template variable; see few-shot selection.)

## Templates

| Template | Used for | View |
| --- | --- | --- |
| `language-rule` | input[0], every request | `{ uiKo }` (the full view also works) |
| `sentence-system` | input[1], sentence intent | full view, `intent = sentence` |
| `word-system` | input[1], word intent | full view, `intent = word` |
| `sentence-reminder` | final user message, part 1, sentence | full view |
| `word-reminder` | final user message, part 1, word | full view |
| `detail-guidance` | partial of both system templates | (inherited) |
| `tone`, `korean-register`, `word-band` | derived variables | (as above) |
| `variants/lean` | evals: replaces `sentence-system` | full view + `leanCharacters` |

## Few-shots

Selection (`uiSuffix = uiLang == "ko" ? "ko" : "en"`;
`isReading = target == uiLang && source != uiLang`):

- sentence: `sentence-polish-{uiSuffix}` if `isPolish`; else
  `sentence-reading-{uiSuffix}` if `isReading`; else
  `sentence-translate-{uiSuffix}`.
- word: `word-polish-{uiSuffix}` if `isPolish`; else
  `word-{mode}-{uiSuffix}`.

The user turn is `user` verbatim. The assistant turn is `assistant`
serialized as **compact JSON in the file's key order**, strings escaped as
JavaScript `JSON.stringify` does (only `"`, `\`, and control characters;
non-ASCII and `<>&` literal). Because the files are kept in
`JSON.stringify(v, null, 2)` form (enforced by a test), the requirement for
other implementations is: take the raw bytes of the `assistant` value and
**remove insignificant whitespace only**; string bytes stay untouched (no
re-escaping, no HTML escaping, no key reordering). v1 `json.Compact` on a
`json.RawMessage` is one known-correct implementation; verify any
`encoding/json/v2`/`jsontext` equivalent against the fixtures. Do not marshal
a Go map/struct: that sorts keys and HTML-escapes `<>&`.

## Live text (code, not templates)

Implemented identically in each app (`prompts.ts`: `liveText`, `userBlocks`,
`sourceBlock`):

- `liveText(s)`: replace every match of
  `<(\s*\/?\s*(?:source|context|adjustments)\b[^<>]*)>` (case-insensitive,
  global; `\s` and `\b` with JavaScript semantics) by `‹$1›` (U+2039,
  group 1, U+203A).
- Context block: `ctx = trim(context)` (JS `String.prototype.trim`: Unicode
  White_Space plus BOM and line terminators). If non-empty:
  `"<context>\n" + liveText(ctx) + "\n</context>\n\n"`.
- Adjustments block (sentence intent only, when `refinements` is non-empty):
  `"<adjustments>\nprevious: " + liveText(previousMain) + "\n" +
  join(["- " + liveText(r) for r in refinements], "\n") + "\n</adjustments>\n\n"`.
  Refinements and `previousMain` are not trimmed. Word intent ignores
  refinements and `previousMain`.
- Source block: `"<source>\n" + liveText(text) + "\n</source>"` (`text` not
  trimmed).
- Final user part 2 = context block + adjustments block + source block.

## Request body

`POST /v1/responses` JSON (key order irrelevant; values must be equal):

```json
{
  "model": "<config.model>",
  "input": [
    { "role": "developer", "content": "<language-rule>" },
    { "role": "developer", "content": "<sentence-system | word-system>" },
    { "role": "user", "content": [{ "type": "input_text", "text": "<few-shot user>" }] },
    { "role": "assistant", "content": "<few-shot assistant JSON>" },
    { "role": "user", "content": [
      { "type": "input_text", "text": "<reminder>", "prompt_cache_breakpoint": { "mode": "explicit" } },
      { "type": "input_text", "text": "<live text>" }
    ] }
  ],
  "text": { "format": { "type": "json_schema", "strict": true,
    "name": "sentence_translation | word_translation",
    "schema": <schemas/sentence.json | schemas/word.json> } },
  "store": false,
  "service_tier": "<config.serviceTier: default | fast>",
  "include": ["reasoning.encrypted_content"],
  "prompt_cache_key": "nt:<cacheVersion>:<intent>:<uiLang>:<source>:<target>:<mode>",
  "prompt_cache_options": { "mode": "explicit", "ttl": "30m" },
  "reasoning": { "effort": "<config.reasoning>" },
  "stream": true
}
```

When `config.reasoning` is not `none`, `reasoning` is
`{ "effort": "<low|medium>", "summary": "detailed" }`. `schema` includes its
`"$schema"` key exactly as in the file.
