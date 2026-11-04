# neotranslate (Go + htmx)

The Go rewrite of the translator: `net/http` + templ + htmx 4 (with the
`hx-sse` extension), Tailwind v4 compiled by the standalone CLI, and the
OpenAI Go SDK. It serves the same UI, prompts and contract as the TypeScript
app in `../src` (both read `../shared/translation`).

Routes: `GET /` (page), `POST /translate` (one streaming run, `text/event-stream`),
`POST /speech` (pronunciation PCM, `audio/L16`), `POST /warm` (free warm-up),
`POST /prefs` and the hashed `/static/` assets.

## Local development

Tools come from `mise` (`go`, `tailwindcss`); templ comes from the `go.mod`
tool directive. `go generate` needs the repository's `node_modules`
(`npm ci` at the root) for the icons.

```sh
cd go
make generate        # shared contract copy, styles, icons, templ, CSS
OPENAI_API_KEY=… go run .          # http://localhost:3000 (PORT overrides)
make test            # go vet, go test, node --test for the client modules
make size            # gzip budget of the page's scripts and stylesheet
make check           # regenerate and fail when a committed copy is stale
```

Browser tests live in `../e2e` (`APP=go npx playwright test -c e2e`). They
start their own fake OpenAI server (`cmd/fakeopenai`) and never make paid
calls.

## Environment

Empty values count as unset. An invalid translation or speech setting never
takes the page down: every run answers with the localized configuration
error instead, naming the variable only.

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

**No `openai/` prefix.** The TypeScript app strips a legacy `openai/` prefix
from `TRANSLATE_MODEL` and `SPEECH_MODEL`; the Go app rejects it (the `/`
fails the model-id pattern) and answers with the configuration error. Strip
the prefix when copying values from the TypeScript project.

Zero retries everywhere (`maxRetries: 0`), `store: false`, and nothing about
content (source, context, refinements, prompts, outputs, audio, provider
error bodies) is logged or traced.

## Deploying to Vercel

Project `translater-go` (`prj_3IE6TKizvmwJgFxixcTJuWiMi4C6`, team
`team_i7CNkt1Y5v3ESWvNols5IEhP`): Go framework preset (`vercel.json`), root
directory `go/`. Generated files are committed, so the build is a plain
`go build`; every asset is embedded in the binary.

```sh
cd go
vercel link --project translater-go          # once; writes go/.vercel (ignored)
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
translation or speech request runs upstream until it completes.

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
# audio), from the repository root. Only this test runs, on one project.
PROD_URL=https://<domain> npx playwright test -c e2e --grep @prod --project chromium-macbook-14
```

The in-memory LRU (50 entries per instance) answers a repeated translation in
one burst, which the smoke tools report as a failure; use another synthetic
sentence (`-text`, or `PROD_SMOKE_TEXT` for the browser test).
