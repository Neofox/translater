package prompt

import (
	"encoding/json/jsontext"
	"encoding/json/v2"
	"os"
	"regexp"
	"slices"
	"strings"
	"testing"

	"github.com/google/go-cmp/cmp"

	"neotranslate/internal/config"
	"neotranslate/internal/contract"
)

// shared/translation is the source of truth; the contract package embeds a
// generated copy, which its own tests keep in sync.
const sharedDir = "../../../shared/translation/"

type fixture struct {
	Name   string         `json:"name"`
	Input  TranslateInput `json:"input"`
	Config struct {
		Model       string `json:"model"`
		Reasoning   string `json:"reasoning"`
		ServiceTier string `json:"serviceTier"`
	} `json:"config"`
	Body any `json:"body"`
}

func loadContract(t *testing.T) *contract.Contract {
	t.Helper()
	c, err := contract.Load()
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func loadFixtures(t *testing.T) []fixture {
	t.Helper()
	b, err := os.ReadFile(sharedDir + "fixtures/requests.json")
	if err != nil {
		t.Fatal(err)
	}
	var fs []fixture
	if err := json.Unmarshal(b, &fs); err != nil {
		t.Fatal(err)
	}
	if len(fs) == 0 {
		t.Fatal("no fixtures")
	}
	return fs
}

func TestBuildRequestMatchesFixtures(t *testing.T) {
	c := loadContract(t)
	for _, f := range loadFixtures(t) {
		t.Run(f.Name, func(t *testing.T) {
			if err := f.Input.Validate(c.Limits); err != nil {
				t.Fatalf("fixture input invalid: %v", err)
			}
			cfg := config.Translate{Model: f.Config.Model, Reasoning: f.Config.Reasoning, ServiceTier: f.Config.ServiceTier}
			b, err := BuildRequest(c, f.Input, cfg)
			if err != nil {
				t.Fatal(err)
			}
			var got any
			if err := json.Unmarshal(b, &got); err != nil {
				t.Fatalf("body is not JSON: %v", err)
			}
			if d := cmp.Diff(f.Body, got); d != "" {
				t.Errorf("body mismatch (-want +got):\n%s", d)
			}
		})
	}
}

// rawSchema returns the request's text.format.schema exactly as encoded,
// compacted: unlike the parsed comparison above, it keeps key order.
func rawSchema(t *testing.T, body []byte) string {
	t.Helper()
	var b struct {
		Text struct {
			Format struct {
				Schema jsontext.Value `json:"schema"`
			} `json:"format"`
		} `json:"text"`
	}
	if err := json.Unmarshal(body, &b, json.RejectUnknownMembers(false)); err != nil {
		t.Fatal(err)
	}
	v := b.Text.Format.Schema.Clone()
	if err := v.Compact(); err != nil {
		t.Fatal(err)
	}
	return string(v)
}

// The model writes fields in schema key order, so property order is part of
// the contract: main must stream before the learner details (a map-ordered,
// alphabetical schema put main after alternatives and the languages last).
// The parsed comparison in TestBuildRequestMatchesFixtures cannot see order.
func TestBuildRequestKeepsSchemaKeyOrder(t *testing.T) {
	c := loadContract(t)
	b, err := os.ReadFile(sharedDir + "fixtures/requests.json")
	if err != nil {
		t.Fatal(err)
	}
	var raw []struct {
		Name string         `json:"name"`
		Body jsontext.Value `json:"body"`
	}
	if err := json.Unmarshal(b, &raw); err != nil {
		t.Fatal(err)
	}
	for i, f := range loadFixtures(t) {
		t.Run(f.Name, func(t *testing.T) {
			cfg := config.Translate{Model: f.Config.Model, Reasoning: f.Config.Reasoning, ServiceTier: f.Config.ServiceTier}
			body, err := BuildRequest(c, f.Input, cfg)
			if err != nil {
				t.Fatal(err)
			}
			got := rawSchema(t, body)
			if want := rawSchema(t, raw[i].Body); got != want {
				t.Errorf("schema bytes differ from the captured TS request (key order?)\n got: %.200s\nwant: %.200s", got, want)
			}
			shared := jsontext.Value(slices.Clone(c.Schemas[f.Input.Intent]))
			if err := shared.Compact(); err != nil {
				t.Fatal(err)
			}
			if got != string(shared) {
				t.Errorf("schema bytes differ from shared/translation/schemas/%s", f.Input.Intent)
			}
		})
	}
}

// The fixtures cover every flag combination the app sends; this guards the
// view itself: a section name missing from the view would silently render
// as false, so the key set must equal the README's variable table exactly.
func TestViewKeysMatchReadme(t *testing.T) {
	readme, err := os.ReadFile(sharedDir + "README.md")
	if err != nil {
		t.Fatal(err)
	}
	section := string(readme)
	section = section[strings.Index(section, "## Variables"):strings.Index(section, "## Templates")]
	var want []string
	for _, m := range regexp.MustCompile("(?m)^\\| `([A-Za-z]+)` \\|").FindAllStringSubmatch(section, -1) {
		if m[1] == "leanCharacters" { // eval variants only
			continue
		}
		want = append(want, m[1])
	}
	if len(want) < 20 {
		t.Fatalf("parsed only %d README variables: %v", len(want), want)
	}
	slices.Sort(want)

	c := loadContract(t)
	for _, in := range []TranslateInput{
		{Text: "x", Source: "en", Target: "ko", Mode: "casual", Intent: "sentence", UILang: "en"},
		{Text: "x", Source: "auto", Target: "en", Mode: "friends", Intent: "word", UILang: "ko"},
	} {
		v, err := View(c, in)
		if err != nil {
			t.Fatal(err)
		}
		var got []string
		for k, val := range v {
			got = append(got, k)
			switch val.(type) {
			case string, bool:
			default:
				t.Errorf("%s has type %T, want string or bool", k, val)
			}
		}
		slices.Sort(got)
		if d := cmp.Diff(want, got); d != "" {
			t.Errorf("%s view keys (-README +view):\n%s", in.Intent, d)
		}
	}
}

func TestFlagsDefinitions(t *testing.T) {
	f := Flags(TranslateInput{Source: "auto", Target: "ja", Mode: "professional", Intent: "word", UILang: "ko"})
	want := map[string]any{
		"source": "auto", "target": "ja", "uiLang": "ko",
		"sourceName": "the auto-detected source language", "targetName": "Japanese", "uiLangName": "Korean",
		"metaLang": "KOREAN", "uiKo": true, "isPolish": false, "kr": false, "autoSource": true,
		"intentSentence": false, "modeFriends": false, "modeCasual": false, "modeProfessional": true,
		"modeUpper": "PROFESSIONAL", "populateFormalityNote": false, "detailReminder": true,
		"manyAlternatives": true,
	}
	if d := cmp.Diff(want, f); d != "" {
		t.Errorf("flags (-want +got):\n%s", d)
	}
	// detailReminder: English-only pairs and polishing get no reminder.
	for _, tc := range []struct {
		source, target string
		want           bool
	}{{"auto", "en", false}, {"en", "en", false}, {"ko", "ko", false}, {"ko", "en", true}, {"en", "ko", true}} {
		got := Flags(TranslateInput{Source: tc.source, Target: tc.target, Mode: "casual", Intent: "sentence", UILang: "en"})["detailReminder"]
		if got != tc.want {
			t.Errorf("detailReminder(%s→%s) = %v, want %v", tc.source, tc.target, got, tc.want)
		}
	}
}

func TestLanguageEnumsMatchContract(t *testing.T) {
	c := loadContract(t)
	var codes []string
	for _, l := range c.Languages {
		codes = append(codes, l.Code)
		if promptNames[l.Code] != l.PromptName {
			t.Errorf("promptName %s = %q, contract %q", l.Code, promptNames[l.Code], l.PromptName)
		}
	}
	if d := cmp.Diff(codes, sourceLangs); d != "" {
		t.Errorf("source languages (-contract +package):\n%s", d)
	}
	if d := cmp.Diff(slices.DeleteFunc(slices.Clone(codes), func(s string) bool { return s == "auto" }), targetLangs); d != "" {
		t.Errorf("target languages (-contract +package):\n%s", d)
	}
	if len(promptNames) != len(c.Languages) {
		t.Errorf("promptNames has %d entries, contract %d", len(promptNames), len(c.Languages))
	}
}
