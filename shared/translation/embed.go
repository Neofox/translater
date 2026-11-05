// Package translation embeds the language-neutral translation contract
// (README.md) for the Go app; internal/contract decodes it. The contract is
// data: this file only exists because go:embed reads files from its own
// package directory. The golden request bodies in fixtures/ are test data
// and stay out of the binary.
package translation

import "embed"

// FS holds the files the app loads at startup.
//
//go:embed i18n/strings.json languages.json limits.json meta.json preferences.json
//go:embed fewshots/*.json schemas/*.json
//go:embed prompts
var FS embed.FS
