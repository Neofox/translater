# Build helpers. Tools come from mise (go, tailwindcss) and the go.mod tool
# directive (templ). Generated files are committed; `make check` fails when
# any is stale. `go generate` also needs node_modules (lucide-static for the
# icons): run `npm ci` first.

TAILWIND := mise exec -- tailwindcss
CSS_IN   := web/static/css/input.css
CSS_OUT  := web/static/css/app.css
# Script gzip target: 40 KB, raised to 42 KB with the inspection gestures
# and to 44 KB with the measured Adjust menu (a target, not a gate: never
# cut a feature or parity to meet it).
SIZE_MAX := 45056
# Stylesheet gzip budget: the previous (TypeScript) app's compiled
# stylesheet when the Go app replaced it (29524 B; app.css was then 29329 B).
CSS_MAX  := 29524

.PHONY: all generate icons templ css test size check

all: generate size

# Icons (syncicons), then templ output and the Tailwind build.
generate:
	go generate ./...
	$(MAKE) templ css

icons:
	go generate ./internal/web/icons/

templ:
	go tool templ generate

css:
	$(TAILWIND) --input $(CSS_IN) --output $(CSS_OUT) --minify

test:
	go vet ./...
	go test ./...
	node --test 'web/static/js/*.test.js'

# Gzip bytes of every script GET / loads (htmx and hx-sse included), and of
# the stylesheet.
size:
	go run ./cmd/assetsize -max $(SIZE_MAX) -css-max $(CSS_MAX)

# Regenerate everything and fail when a committed generated file changed.
check: generate
	git diff --exit-code -- . ':(exclude)go.sum'
