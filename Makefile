# Build helpers. Go comes from your own install (go.mod's `go` line is the
# minimum), templ from the go.mod tool directive, and tailwindcss and
# lucide-static (icons) from node_modules: run `npm ci` first. Generated
# files are committed; `make check` fails when any is stale.

TAILWIND := node_modules/.bin/tailwindcss
CSS_IN   := web/static/css/input.css
CSS_OUT  := web/static/css/app.css
# Script gzip target: 40 KB, raised to 42 KB with the inspection gestures
# and to 44 KB with the measured Adjust menu (a target, not a gate: never
# cut a feature or parity to meet it).
SIZE_MAX := 45056
# Stylesheet gzip target: 29,000 B, the compiled app.css (28,898 B with the
# Copy confirmation) rounded up to the next thousand. Like the script
# target, raise it deliberately with the change that needs it.
CSS_MAX  := 29000

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
