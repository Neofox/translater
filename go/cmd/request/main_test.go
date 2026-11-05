package main

import (
	"bytes"
	"encoding/json/jsontext"
	"encoding/json/v2"
	"os"
	"strings"
	"testing"

	"github.com/google/go-cmp/cmp"
)

// golden is one entry of shared/translation/fixtures/{requests,variants}.json.
type golden struct {
	Name    string         `json:"name"`
	Variant string         `json:"variant"`
	Input   jsontext.Value `json:"input"`
	Config  jsontext.Value `json:"config"`
	Body    any            `json:"body"`
}

// The command reproduces every golden body from the fixture's own input,
// config and variant, as the eval provider sends them.
func TestBuildBodyMatchesFixtures(t *testing.T) {
	n := 0
	for _, file := range []string{"requests.json", "variants.json"} {
		raw, err := os.ReadFile("../../../shared/translation/fixtures/" + file)
		if err != nil {
			t.Fatal(err)
		}
		var fixtures []golden
		if err := json.Unmarshal(raw, &fixtures); err != nil {
			t.Fatal(err)
		}
		for _, f := range fixtures {
			n++
			t.Run(f.Name, func(t *testing.T) {
				// The fixtures carry the TS-era analyticsTrigger, which the
				// command (strict about unknown fields) does not accept.
				var input map[string]any
				if err := json.Unmarshal(f.Input, &input); err != nil {
					t.Fatal(err)
				}
				delete(input, "analyticsTrigger")
				stdin, err := json.Marshal(map[string]any{"input": input, "config": f.Config, "variant": f.Variant})
				if err != nil {
					t.Fatal(err)
				}
				var out bytes.Buffer
				if err := buildBody(bytes.NewReader(stdin), &out); err != nil {
					t.Fatal(err)
				}
				var got any
				if err := json.Unmarshal(out.Bytes(), &got); err != nil {
					t.Fatal(err)
				}
				if d := cmp.Diff(f.Body, got); d != "" {
					t.Errorf("body (-golden +command):\n%s", d)
				}
			})
		}
	}
	if n < 40 {
		t.Fatalf("only %d fixtures", n)
	}
}

func TestBuildBodyRejects(t *testing.T) {
	input := `{"text":"hi","source":"en","target":"ko","mode":"casual","intent":"sentence","uiLang":"en"}`
	for name, stdin := range map[string]string{
		"unknown field":   `{"input":` + input + `,"config":{},"extra":1}`,
		"invalid input":   `{"input":{"text":"","source":"en","target":"ko","mode":"casual","intent":"sentence","uiLang":"en"},"config":{}}`,
		"invalid config":  `{"input":` + input + `,"config":{"reasoning":"high"}}`,
		"unknown variant": `{"input":` + input + `,"config":{},"variant":"short"}`,
	} {
		if err := buildBody(strings.NewReader(stdin), &bytes.Buffer{}); err == nil {
			t.Errorf("%s accepted", name)
		}
	}
	// Empty config fields take the deployment defaults.
	var out bytes.Buffer
	if err := buildBody(strings.NewReader(`{"input":`+input+`,"config":{}}`), &out); err != nil {
		t.Fatal(err)
	}
	var body struct {
		Model       string `json:"model"`
		ServiceTier string `json:"service_tier"`
		Stream      bool   `json:"stream"`
	}
	if err := json.Unmarshal(out.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Model == "" || body.ServiceTier != "fast" || !body.Stream {
		t.Errorf("defaults: %+v", body)
	}
}

func TestPrepareLearning(t *testing.T) {
	phrase := func(text, grammar string, highlights ...string) map[string]any {
		return map[string]any{
			"text": text, "gloss": "g", "sourceTexts": []string{}, "baseForm": "", "literalMeaning": "",
			"naturalMeaning": "", "grammar": grammar, "omissions": "", "usageNote": "",
			"characters": []any{}, "grammarHighlights": highlights,
		}
	}
	for _, tc := range []struct {
		name    string
		primary string
		phrases []map[string]any
		want    prepareOutput
	}{
		{"covered", "내일 봐요", []map[string]any{phrase("내일", ""), phrase("봐요", "polite", "요")}, prepareOutput{OK: true, GrammarHighlights: 1}},
		{"partial", "내일 봐요", []map[string]any{phrase("내일", "")}, prepareOutput{OK: true, Partial: true}},
		{"unquoted", "내일 봐요", []map[string]any{phrase("모레", "")}, prepareOutput{}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			stdin, err := json.Marshal(map[string]any{"counterpart": "See you tomorrow", "primary": tc.primary, "phrases": tc.phrases})
			if err != nil {
				t.Fatal(err)
			}
			var out bytes.Buffer
			if err := prepareLearning(bytes.NewReader(stdin), &out); err != nil {
				t.Fatal(err)
			}
			var got prepareOutput
			if err := json.Unmarshal(out.Bytes(), &got); err != nil {
				t.Fatal(err)
			}
			if got != tc.want {
				t.Errorf("got %+v, want %+v", got, tc.want)
			}
		})
	}
}
