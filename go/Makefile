# Go app build helpers. Tools come from mise (go, tailwindcss) and the
# go.mod tool directive (templ). Generated files are committed; `make check`
# fails when any is stale. `go generate` also needs the repository's
# node_modules (lucide-static for the icons): run `npm ci` at the root first.

TAILWIND := mise exec -- tailwindcss
CSS_IN   := web/static/css/input.css
CSS_OUT  := web/static/css/app.css
SIZE_MAX := 40960

.PHONY: all generate styles icons templ css test size check

all: generate size

# Shared contract copy, styles (syncstyles) and icons (syncicons), then
# templ output and the Tailwind build.
generate:
	go generate ./...
	$(MAKE) templ css

styles:
	go generate ./web/

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
# the stylesheet (at most the TS app's 28.7 KiB).
size:
	go run ./cmd/assetsize -max $(SIZE_MAX)

# Regenerate everything and fail when the committed copies changed.
check: generate
	git diff --exit-code -- . ':(exclude)go.sum'
