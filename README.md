# NeoTranslate

A streaming translator and language-learning tool, EN↔KO first. Go
(`net/http` + templ) serves the page; htmx 4 with the `hx-sse` extension and a
few plain ES modules drive it; Tailwind v4 compiles the stylesheet; the OpenAI
Go SDK streams structured output from the Responses API. The prompts, schemas
and UI strings live in the language-neutral contract under
`shared/translation`, which the binary embeds.

Routes: `GET /` (page), `POST /translate` (one streaming run,
`text/event-stream`), `POST /speech` (pronunciation PCM, `audio/L16`),
`POST /warm` (free warm-up), `POST /prefs` and the hashed `/static/` assets.

`AGENTS.md` describes the architecture and the product rules in detail.

## Local development

You need Go (the version in `go.mod`) and Node.js with npm. templ comes from
the `go.mod` tool directive; tailwindcss and lucide-static (icons) come from
`npm ci`.

```sh
npm ci
make generate        # icons, templ, CSS
OPENAI_API_KEY=… go run .          # http://localhost:3000 (PORT overrides)
make test            # go vet, go test, node --test for the client modules
make size            # gzip budget of the page's scripts and stylesheet
make check           # regenerate and fail when a committed file is stale
npm run typecheck    # the TypeScript tooling (e2e suite, evals)
```

Browser tests live in `e2e` (`npx playwright install chromium webkit` once,
then for example `npm run e2e -- --grep @core`). They start their own fake
OpenAI server (`cmd/fakeopenai`) and never make paid calls. The visual
regression suite writes baselines with `npm run e2e:visual:update` and
compares with `npm run e2e:visual`.

## Environment

Empty values count as unset. An invalid translation or speech setting never
takes the page down: every run answers with the localized configuration
error instead, naming the variable only. `.env.example` lists them; keep
credentials in ignored env files or Vercel environment settings.

| Variable                       | Default                      | Secret | Notes                                                                                                                                             |
| ------------------------------ | ---------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OPENAI_API_KEY`               | (none)                       | yes    | Read per request. Missing: translations and speech end with the configuration error.                                                              |
| `TRANSLATE_MODEL`              | `gpt-6.1-terra`              | no     | One exact OpenAI model id (`^[a-z0-9][a-z0-9._-]*$`, case-insensitive). No fallback model. The default comes from `shared/translation/meta.json`. |
| `TRANSLATE_REASONING`          | `none`                       | no     | `none`, `low` or `medium`.                                                                                                                        |
| `TRANSLATE_SERVICE_TIER`       | `fast`                       | no     | `default` or `fast` (OpenAI priority processing, 2× price; OpenAI silently serves Standard when Fast is unavailable).                             |
| `SPEECH_MODEL`                 | `gpt-4o-mini-tts`            | no     | One exact OpenAI speech model id (same pattern). It must return mono PCM16 WAV at 8–48 kHz.                                                       |
| `SPEECH_VOICE`                 | `marin`                      | no     | Any voice id: trimmed, nonempty, at most 200 characters, no control characters.                                                                   |
| `LANGFUSE_PUBLIC_KEY`          | (none)                       | yes    | Langfuse tracing is on only when both keys are set. Traces are content-free generations; cache hits and speech are never traced.                  |
| `LANGFUSE_SECRET_KEY`          | (none)                       | yes    | See above.                                                                                                                                        |
| `LANGFUSE_BASE_URL`            | `https://cloud.langfuse.com` | no     | OTLP traces go to `<base>/api/public/otel/v1/traces`.                                                                                             |
| `LANGFUSE_TRACING_ENVIRONMENT` | (none)                       | no     | `langfuse.environment` resource attribute.                                                                                                        |
| `LANGFUSE_RELEASE`             | (none)                       | no     | `langfuse.release` resource attribute.                                                                                                            |
| `PORT`                         | `3000`                       | no     | Listen port. Vercel's Go runtime sets it.                                                                                                         |
| `OPENAI_BASE_URL`              | OpenAI                       | no     | Tests only: points the SDK at the fake server. Never set it in production.                                                                        |
| `VERCEL`, `VERCEL_ENV`         | (set by Vercel)              | no     | Either one enables the Vercel Web Analytics script tag.                                                                                           |

**No `openai/` prefix.** Model ids are bare: an `openai/` prefix fails the
model-id pattern and answers with the configuration error.

Zero retries everywhere, `store: false`, and nothing about content (source,
context, refinements, prompts, outputs, audio, provider error bodies) is
logged or traced.

## Deploying to Vercel

Project `translater-go` (`prj_3IE6TKizvmwJgFxixcTJuWiMi4C6`, team
`team_i7CNkt1Y5v3ESWvNols5IEhP`): Go framework preset (`vercel.json`), root
directory = the repository root, function region `icn1` (Seoul). Generated
files are committed, so the build is a plain `go build`; every asset and the
shared contract are embedded in the binary, and `.vercelignore` keeps the npm
tooling out of the upload. Domains: `www.neofox.dev` (`neofox.dev` redirects
to it) and `translate.jers.dev`.

The project is connected to `Neofox/translater`: a push to `master` deploys
production and every other branch gets a preview. A manual deploy runs from
the repository root:

```sh
vercel link --project translater-go          # once; writes .vercel (ignored)
printf %s "$VALUE" | vercel env add NAME production   # per variable above
vercel env ls production
vercel deploy --prod
```

After a deploy, check:

- `GET /` answers `Cache-Control: private, no-store` and
  `Vary: Cookie, Accept-Language`.
- Hashed `/static/` assets answer `public, max-age=31536000, immutable`
  (no 404s).
- `POST /translate` answers `text/event-stream` with no `Content-Encoding`,
  and events arrive spread over time, not in one buffered burst.
- `POST /speech` answers `audio/L16;rate=N;channels=1` with a
  `Content-Length`.

When Deployment Protection applies, send the project's automation bypass
secret as the `x-vercel-protection-bypass` header (the smoke tools below read
`VERCEL_AUTOMATION_BYPASS_SECRET`).

Vercel does not cancel a function when the browser disconnects: a superseded
translation stops at its next failed write, and a superseded speech request
runs upstream until it completes.

## Production smoke (billed)

Each command below makes real, billed OpenAI requests. None retries, and none
prints source text, translations, HTML or audio.

```sh
# One translation: time to headers, first frame, first main delta,
# main-ready, done, delta count and spacing. Fails on a buffered or
# compressed stream (or an LRU hit: pass a fresh -text).
go run ./cmd/smoke -url https://<domain> -translate

# One speech request: time to headers, first byte, done, bytes,
# sample rate and whether Content-Length is present.
go run ./cmd/smoke -url https://<domain> -speech

# Browser: one translation + one real pronunciation (no fake, no synthetic
# audio). Only this test runs, on one project.
PROD_URL=https://<domain> npx playwright test -c e2e --grep @prod --project chromium-macbook-14
```

The in-memory LRU (50 entries per instance) answers a repeated translation in
one burst, which the smoke tools report as a failure; use another synthetic
sentence (`-text`, or `PROD_SMOKE_TEXT` for the browser test).

## Quality evals (billed)

`npm run eval:quality` runs the promptfoo quality evals on the production
request body (built by `cmd/request`) and needs `OPENAI_API_KEY` in
`.env.local`. Responses are cached per request, so reruns only pay for new
calls. See `AGENTS.md` for the variants, checks, judge and CI gate.

## Dependency updates

Go modules are pinned in `go.mod`/`go.sum`. npm devDependencies are pinned to
exact versions and `package-lock.json` records the complete tree; commit both
when updating, and use `npm ci` for reproducible installs. `lucide-static`
must match the icon set `internal/web/icons` was generated from (`make icons`
regenerates it), and `@tailwindcss/cli` changes `app.css` (`make css`).
