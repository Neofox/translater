package prompt

import "testing"

// Which request fields distinguish cache entries, and which normalizations
// make two requests share one.

const (
	testVersion = "v-test"
	testLabel   = "gpt-6.1-terra:none:fast"
)

func key(in TranslateInput) string { return CacheKey(in, testVersion, testLabel) }

func TestCacheKey(t *testing.T) {
	base := validInput()
	with := func(edit func(*TranslateInput)) TranslateInput {
		in := base
		in.Refinements = append([]string(nil), base.Refinements...)
		edit(&in)
		return in
	}
	word := with(func(in *TranslateInput) { in.Intent = "word"; in.Text = "배" })
	withWord := func(edit func(*TranslateInput)) TranslateInput {
		in := word
		edit(&in)
		return in
	}

	same := []struct {
		name string
		a, b TranslateInput
	}{
		{"trims context and text", with(func(in *TranslateInput) { in.Context = " hi "; in.Text = " see you tomorrow " }), with(func(in *TranslateInput) { in.Context = "hi" })},
		{"trims refinements", with(func(in *TranslateInput) { in.Refinements = []string{" x "} }), with(func(in *TranslateInput) { in.Refinements = []string{"x"} })},
		{"word ignores refinements and previousMain", word, withWord(func(in *TranslateInput) { in.Refinements = []string{"x"}; in.PreviousMain = "y" })},
		{"ignores stale previousMain without refinements", with(func(in *TranslateInput) { in.PreviousMain = "x" }), base},
	}
	for _, tc := range same {
		if key(tc.a) != key(tc.b) {
			t.Errorf("%s: keys differ:\n%s\n%s", tc.name, key(tc.a), key(tc.b))
		}
	}

	differ := []struct {
		name string
		a, b TranslateInput
	}{
		{"context", base, with(func(in *TranslateInput) { in.Context = "hi" })},
		{"refinements (sentence)", base, with(func(in *TranslateInput) { in.Refinements = []string{"make it softer"} })},
		{"previousMain (sentence)", with(func(in *TranslateInput) { in.Refinements = []string{"x"}; in.PreviousMain = "a" }), with(func(in *TranslateInput) { in.Refinements = []string{"x"}; in.PreviousMain = "b" })},
		{"word context", word, withWord(func(in *TranslateInput) { in.Context = "배 타고 왔어" })},
		{"intent", base, with(func(in *TranslateInput) { in.Intent = "word" })},
		{"mode", base, with(func(in *TranslateInput) { in.Mode = "professional" })},
		{"source", base, with(func(in *TranslateInput) { in.Source = "auto" })},
		{"target", base, with(func(in *TranslateInput) { in.Target = "ja" })},
		{"uiLang", base, with(func(in *TranslateInput) { in.UILang = "ko" })},
		{"text", base, with(func(in *TranslateInput) { in.Text = "other" })},
		// Field boundaries cannot be forged by moving text between fields.
		{"field boundaries", with(func(in *TranslateInput) { in.Text = "a"; in.Context = "b" }), with(func(in *TranslateInput) { in.Text = "a\",\"b"; in.Context = "" })},
		{"refinement boundaries", with(func(in *TranslateInput) { in.Refinements = []string{"a", "b"} }), with(func(in *TranslateInput) { in.Refinements = []string{"a\",\"b"} })},
	}
	for _, tc := range differ {
		if key(tc.a) == key(tc.b) {
			t.Errorf("%s: keys equal: %s", tc.name, key(tc.a))
		}
	}

	if CacheKey(base, testVersion, "gpt-6.1-terra:none:fast") == CacheKey(base, testVersion, "gpt-6.1-sol:low:fast") {
		t.Error("config label not in key")
	}
	if CacheKey(base, "v1", testLabel) == CacheKey(base, "v2", testLabel) {
		t.Error("cache version not in key")
	}
}

func TestPromptCacheKey(t *testing.T) {
	base := validInput()
	if got, want := PromptCacheKey(base, "v9"), "nt:v9:sentence:en:en:ko:casual"; got != want {
		t.Errorf("PromptCacheKey = %q, want %q", got, want)
	}
	live := base
	live.Text, live.Context, live.Refinements, live.PreviousMain = "different", "ctx", []string{"shorter"}, "old"
	if PromptCacheKey(live, "v9") != PromptCacheKey(base, "v9") {
		t.Error("live input changed the prompt cache key")
	}
}
