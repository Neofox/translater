package prompt

import (
	"encoding/json/jsontext"
	"encoding/json/v2"
	"strings"
)

// CacheKey identifies a translation result in the server LRU. Same fields
// and semantics as cacheKeyFor (src/server/cacheKey.ts): text and context
// trimmed, refinements trimmed and ignored for word intent, previousMain
// only when it anchors at least one refinement. configLabel is
// config.Translate.Label() (model, reasoning, tier). A JSON array keeps
// field boundaries unforgeable; bytes need not equal the TS key.
func CacheKey(in TranslateInput, cacheVersion, configLabel string) string {
	isWord := in.Intent == "word"
	refinements := []string{}
	previousMain := ""
	if !isWord {
		for _, r := range in.Refinements {
			refinements = append(refinements, JSTrim(r))
		}
		if len(in.Refinements) > 0 {
			previousMain = in.PreviousMain
		}
	}
	b, err := json.Marshal([]any{
		cacheVersion, configLabel, in.Intent, in.Mode, in.Source, in.Target, in.UILang,
		JSTrim(in.Text), JSTrim(in.Context), refinements, previousMain,
	}, jsontext.AllowInvalidUTF8(true))
	if err != nil { // strings always marshal once invalid UTF-8 is allowed
		panic(err)
	}
	return string(b)
}

// PromptCacheKey routes requests with an identical instructions + few-shot
// prefix to the same OpenAI prompt cache (promptCacheKeyFor). Live input
// follows the cache breakpoint and is deliberately absent.
func PromptCacheKey(in TranslateInput, cacheVersion string) string {
	return strings.Join([]string{"nt", cacheVersion, in.Intent, in.UILang, in.Source, in.Target, in.Mode}, ":")
}
