package config

import (
	"errors"
	"testing"
)

func env(m map[string]string) func(string) string { return func(k string) string { return m[k] } }

func TestDefaults(t *testing.T) {
	got, err := LoadTranslate(env(nil))
	if err != nil {
		t.Fatal(err)
	}
	want := Translate{Model: "gpt-6.1-terra", Reasoning: "none", ServiceTier: "fast"}
	if got != want {
		t.Fatalf("got %+v want %+v", got, want)
	}
	if got.Label() != "gpt-6.1-terra:none:fast" {
		t.Fatalf("label %q", got.Label())
	}
}

func TestReadsModelReasoningAndTier(t *testing.T) {
	got, err := LoadTranslate(env(map[string]string{
		"TRANSLATE_MODEL": " gpt-6.1-sol ", "TRANSLATE_REASONING": "low", "TRANSLATE_SERVICE_TIER": "default",
	}))
	if err != nil {
		t.Fatal(err)
	}
	if got != (Translate{Model: "gpt-6.1-sol", Reasoning: "low", ServiceTier: "default"}) {
		t.Fatalf("got %+v", got)
	}
}

func TestRejects(t *testing.T) {
	for name, e := range map[string]map[string]string{
		"provider prefix":      {"TRANSLATE_MODEL": "anthropic/claude-haiku-5.5"},
		"space":                {"TRANSLATE_MODEL": "gpt 6"},
		"legacy openai prefix": {"TRANSLATE_MODEL": "openai/gpt-6-luna"},
		"bare openai/":         {"TRANSLATE_MODEL": "openai/"},
		"reasoning":            {"TRANSLATE_REASONING": "provider-default"},
		"tier":                 {"TRANSLATE_SERVICE_TIER": "priority"},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := LoadTranslate(env(e)); !errors.Is(err, ErrConfiguration) {
				t.Fatalf("err = %v, want ErrConfiguration", err)
			}
		})
	}
}
