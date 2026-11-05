// Package prompt turns a validated translation request into the exact OpenAI
// Responses request body (shared/translation/README.md defines every flag,
// block and field; `go test ./internal/prompt -update` writes the golden
// bodies in shared/translation/fixtures) and derives the translation cache
// keys.
package prompt

import (
	"errors"
	"fmt"
	"regexp"
	"slices"
	"strings"
	"unicode"
	"unicode/utf16"

	"neotranslate/internal/contract"
)

// TranslateInput is one translation request. Text and PreviousMain are used
// verbatim; Context is trimmed (JS semantics) by the prompt and cache key.
type TranslateInput struct {
	Text         string   `json:"text"`
	Source       string   `json:"source"`
	Target       string   `json:"target"`
	Mode         string   `json:"mode"`
	Intent       string   `json:"intent"`
	UILang       string   `json:"uiLang"`
	Context      string   `json:"context"`
	PreviousMain string   `json:"previousMain"`
	Refinements  []string `json:"refinements"`
}

// Enumerations from shared/translation/README.md ("Variables") and
// languages.json; TestLanguageEnumsMatchContract keeps them in sync.
var (
	sourceLangs = []string{"auto", "en", "ko", "ja", "fr", "es", "zh"}
	targetLangs = []string{"en", "ko", "ja", "fr", "es", "zh"}
	modes       = []string{"friends", "casual", "professional"}
	intents     = []string{"sentence", "word"}
	uiLangs     = []string{"en", "ko"}
	promptNames = map[string]string{
		"auto": "the auto-detected source language",
		"en":   "English",
		"ko":   "Korean",
		"ja":   "Japanese",
		"fr":   "French",
		"es":   "Spanish",
		"zh":   "Chinese",
	}
)

// ErrInvalidInput marks a request that fails validation.
var ErrInvalidInput = errors.New("invalid translation input")

// FieldError names the offending field only; it never carries user text.
type FieldError struct {
	Field  string
	Reason string
}

func (e *FieldError) Error() string {
	return fmt.Sprintf("%v: %s %s", ErrInvalidInput, e.Field, e.Reason)
}

func (e *FieldError) Unwrap() error { return ErrInvalidInput }

// Validate applies the shared limits and enumerations. Lengths are UTF-16
// code units, as the browser's textarea counts them, so "non-empty" means
// length ≥ 1 (whitespace counts).
func (in TranslateInput) Validate(l contract.Limits) error {
	bad := func(field, reason string) error { return &FieldError{Field: field, Reason: reason} }
	switch {
	case in.Text == "":
		return bad("text", "is empty")
	case utf16Len(in.Text) > l.MaxInputChars:
		return bad("text", "is too long")
	case !slices.Contains(sourceLangs, in.Source):
		return bad("source", "is not a supported language")
	case !slices.Contains(targetLangs, in.Target):
		return bad("target", "is not a supported language")
	case !slices.Contains(modes, in.Mode):
		return bad("mode", "is not supported")
	case !slices.Contains(intents, in.Intent):
		return bad("intent", "is not supported")
	case !slices.Contains(uiLangs, in.UILang):
		return bad("uiLang", "is not supported")
	case utf16Len(in.Context) > l.MaxContextChars:
		return bad("context", "is too long")
	case len(in.Refinements) > l.MaxRefinements:
		return bad("refinements", "has too many entries")
	case utf16Len(in.PreviousMain) > l.MaxInputChars:
		return bad("previousMain", "is too long")
	}
	for _, r := range in.Refinements {
		if r == "" || utf16Len(r) > l.MaxRefinementChars {
			return bad("refinements", "has an empty or too long entry")
		}
	}
	return nil
}

// utf16Len is JS String.prototype.length.
func utf16Len(s string) int {
	n := 0
	for _, r := range s {
		n += utf16.RuneLen(r)
	}
	return n
}

// JSTrim is JS String.prototype.trim: Unicode White_Space plus the BOM.
// unicode.IsSpace differs only by including U+0085, which JS keeps.
func JSTrim(s string) string {
	return strings.TrimFunc(s, func(r rune) bool {
		return r == '\uFEFF' || (r != '\u0085' && unicode.IsSpace(r))
	})
}

// blockTag is the block-tag pattern of the original TypeScript prompts,
// /<(\s*\/?\s*(?:source|context|adjustments)\b[^<>]*)>/gi, with JavaScript
// semantics spelled out because RE2 differs: JS \s also covers \v, NBSP,
// the Zs spaces, LS/PS and the BOM; JS /i without /u does not fold
// non-ASCII letters (U+017F ſ never matches s), so letters are ASCII
// classes rather than (?i). \b is an ASCII word boundary in both.
var blockTag = func() *regexp.Regexp {
	const ws = `[` + jsSpace + `]`
	ci := func(word string) string {
		var b strings.Builder
		for _, c := range word {
			fmt.Fprintf(&b, "[%c%c]", c, unicode.ToUpper(c))
		}
		return b.String()
	}
	return regexp.MustCompile(`<(` + ws + `*/?` + ws + `*(?:` +
		ci("source") + `|` + ci("context") + `|` + ci("adjustments") +
		`)\b[^<>]*)>`)
}()

// LiveText replaces the angle brackets of pasted <source>/<context>/
// <adjustments> tags with look-alike quotes (‹ ›) so live text can never
// open or close a prompt block.
func LiveText(s string) string { return blockTag.ReplaceAllString(s, "‹${1}›") }

// LiveInput is the second text part of the final user message: the optional
// context and adjustments blocks followed by the source block. Word intent
// passes only context.
func LiveInput(in TranslateInput) string {
	var b strings.Builder
	if ctx := JSTrim(in.Context); ctx != "" {
		b.WriteString("<context>\n" + LiveText(ctx) + "\n</context>\n\n")
	}
	if in.Intent == "sentence" && len(in.Refinements) > 0 {
		b.WriteString("<adjustments>\nprevious: " + LiveText(in.PreviousMain) + "\n")
		for i, r := range in.Refinements {
			if i > 0 {
				b.WriteString("\n")
			}
			b.WriteString("- " + LiveText(r))
		}
		b.WriteString("\n</adjustments>\n\n")
	}
	b.WriteString("<source>\n" + LiveText(in.Text) + "\n</source>")
	return b.String()
}
