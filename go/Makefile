# Go app build helpers. Tools come from mise (go, tailwindcss) and the
# go.mod tool directive (templ). Generated files are committed; `make check`
# fails when any is stale. `go generate` also needs the repository's
# node_modules (lucide-static for the icons): run `npm ci` at the root first.

TAILWIND := mise exec -- tailwindcss
CSS_IN   := web/static/css/input.css
CSS_OUT  := web/static/css/app.css
# Script gzip target: 40 KB, raised to 42 KB with the inspection gestures
# (a target, not a gate: never cut a feature or parity to meet it).
SIZE_MAX := 43008
# The TS app's stylesheet, compiled from src/styles.css with the same
# Tailwind CLI, as the CSS budget. Run from src/ so automatic source
# detection scans only the TS sources: from the repository root it also
# picks up go/, e2e/ and fixture strings (+721 B gzip).
TS_CSS   := $(or $(TMPDIR),/tmp)/neotranslate-ts-styles.css

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
# the stylesheet (at most the TS app's, compiled now).
size:
	$(TAILWIND) --cwd ../src --input styles.css --output $(TS_CSS) --minify
	go run ./cmd/assetsize -max $(SIZE_MAX) -css-ref $(TS_CSS)

# Regenerate everything and fail when the committed copies changed.
check: generate
	git diff --exit-code -- . ':(exclude)go.sum'
