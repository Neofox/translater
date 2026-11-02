# Go app build helpers. Tools come from mise (go, tailwindcss) and the
# go.mod tool directive (templ). Generated files are committed; `make check`
# fails when any is stale.

TAILWIND := mise exec -- tailwindcss
CSS_IN   := web/static/css/input.css
CSS_OUT  := web/static/css/app.css
SIZE_MAX := 40960

.PHONY: all generate templ css test test-js size check

all: generate size

generate:
	go generate ./...
	$(MAKE) templ css

templ:
	go tool templ generate

css:
	$(TAILWIND) --input $(CSS_IN) --output $(CSS_OUT) --minify

test:
	go vet ./...
	go test ./...
	node --test 'web/static/js/*.test.js'

# Gzip bytes of every script GET / loads (htmx and hx-sse included).
size:
	go run ./cmd/assetsize -max $(SIZE_MAX)

# Regenerate everything and fail when the committed copies changed.
check: generate
	git diff --exit-code -- . ':(exclude)go.sum'
