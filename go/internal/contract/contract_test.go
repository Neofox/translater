package contract

import (
	"encoding/json/v2"
	"os"
	"strings"
	"testing"

	"github.com/cbroglie/mustache"
)

func load(t *testing.T) *Contract {
	t.Helper()
	c, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func TestCacheVersionMatchesShared(t *testing.T) {
	b, err := os.ReadFile("../../../shared/translation/meta.json")
	if err != nil {
		t.Fatal(err)
	}
	var meta struct{ CacheVersion, DefaultModel string }
	if err := json.Unmarshal(b, &meta, json.MatchCaseInsensitiveNames(true)); err != nil {
		t.Fatal(err)
	}
	c := load(t)
	if c.CacheVersion != meta.CacheVersion || c.DefaultModel != meta.DefaultModel || c.CacheVersion == "" {
		t.Fatalf("contract %q/%q, shared %q/%q", c.CacheVersion, c.DefaultModel, meta.CacheVersion, meta.DefaultModel)
	}
}

func TestLoadsEverything(t *testing.T) {
	c := load(t)
	for _, n := range []string{"language-rule", "sentence-system", "word-system", "sentence-reminder", "word-reminder", "detail-guidance", "tone", "korean-register", "word-band", "variants/lean"} {
		if c.Templates[n] == nil {
			t.Errorf("template %q missing", n)
		}
	}
	if len(c.Fewshots) != 14 {
		t.Errorf("fewshots = %d, want 14", len(c.Fewshots))
	}
	for _, n := range []string{"sentence", "word"} {
		if len(c.Schemas[n]) == 0 {
			t.Errorf("schema %q empty", n)
		}
	}
	if len(c.Languages) != 7 || c.Limits.MaxInputChars != 4000 || c.Limits.MaxContextChars != 1000 {
		t.Errorf("languages/limits: %d %+v", len(c.Languages), c.Limits)
	}
	if got := c.T("ko", "adjust"); got == "adjust" || got == "" {
		t.Errorf("T(ko, adjust) = %q", got)
	}
	if got := c.T("en", "adjust"); got != "Adjust" {
		t.Errorf("T(en, adjust) = %q", got)
	}
	if got := c.T("en", "no-such-key"); got != "no-such-key" {
		t.Errorf("missing key = %q", got)
	}
}

func TestPrefRulesOrderAndNulls(t *testing.T) {
	r := load(t).Prefs
	var keys []string
	for _, f := range r.Fields {
		keys = append(keys, f.Key)
	}
	if strings.Join(keys, ",") != "source,target,mode,uiLang,recentSource,recentTarget" {
		t.Fatalf("field order %v", keys)
	}
	if r.Cookie != "nt.preferences" || r.Version != 1 || r.MaxAgeSeconds != 31536000 || r.MaxCookieLength != 1024 {
		t.Fatalf("rules %+v", r)
	}
	if r.Fields[4].Values[0] != nil || r.Fields[0].Values[0] == nil {
		t.Fatalf("null handling: recentSource[0]=%v source[0]=%v", r.Fields[4].Values[0], r.Fields[0].Values[0])
	}
}

// Every golden request body's few-shot assistant turn must equal ours: proves
// compaction touches whitespace only.
func TestFewshotAssistantMatchesGolden(t *testing.T) {
	c := load(t)
	b, err := dataFS.ReadFile("data/fixtures/requests.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		Name string
		Body struct {
			Input []struct {
				Role    string
				Content any
			}
		}
	}
	if err := json.Unmarshal(b, &cases, json.MatchCaseInsensitiveNames(true)); err != nil {
		t.Fatal(err)
	}
	have := map[string]bool{}
	for _, f := range c.Fewshots {
		have[f.Assistant] = true
	}
	if len(cases) == 0 {
		t.Fatal("no fixtures")
	}
	for _, cs := range cases {
		s, _ := cs.Body.Input[3].Content.(string)
		if !have[s] {
			t.Errorf("%s: golden assistant few-shot not produced by Load", cs.Name)
		}
	}
}

func TestRenderIsUnescaped(t *testing.T) {
	c, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	// Unescaped variable in a top-level template and, via a partial, in a nested one.
	c.Templates["probe"], err = mustache.ParseStringPartials(rawify("{{x}}\n{{> inner}}\n"), partials{"inner": rawify("{{x}}\n")})
	if err != nil {
		t.Fatal(err)
	}
	got, err := c.Render("probe", map[string]any{"x": `<b> & "q" 'a'`})
	if err != nil {
		t.Fatal(err)
	}
	want := "<b> & \"q\" 'a'\n<b> & \"q\" 'a'"
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestRenderStripsOneTrailingNewline(t *testing.T) {
	c := load(t)
	c.Templates["nl"], _ = mustache.ParseStringPartials("a\n\n", partials{})
	got, _ := c.Render("nl", map[string]any{})
	if got != "a\n" {
		t.Fatalf("got %q", got)
	}
}

func TestMissingVariableFails(t *testing.T) {
	c := load(t)
	c.Templates["var"], _ = mustache.ParseStringPartials(rawify("{{missing}}"), partials{})
	if _, err := c.Render("var", map[string]any{}); err == nil {
		t.Fatal("render with empty view succeeded")
	}
}

func TestMissingPartialFails(t *testing.T) {
	c := load(t)
	var err error
	c.Templates["bad"], err = mustache.ParseStringPartials("x {{> nope}}\n", partials{})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := c.Render("bad", nil); err == nil {
		t.Fatal("missing partial rendered")
	}
}

func TestUnknownTemplate(t *testing.T) {
	if _, err := load(t).Render("nope", nil); err == nil {
		t.Fatal("expected error")
	}
}

func TestForbiddenTagsRejected(t *testing.T) {
	for _, tag := range []string{"{{{x}}}", "{{& x}}", "{{=<% %>=}}"} {
		_, err := parseTemplates(map[string]string{"bad-one": "a " + tag + "\n"})
		if err == nil || !strings.Contains(err.Error(), `"bad-one"`) {
			t.Errorf("%s: err = %v, want error naming the template", tag, err)
		}
	}
	if _, err := parseTemplates(map[string]string{"ok": "{{x}}\n"}); err != nil {
		t.Errorf("plain variable rejected: %v", err)
	}
}
