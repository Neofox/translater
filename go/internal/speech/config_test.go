package speech_test

import (
	"errors"
	"strings"
	"testing"

	"neotranslate/internal/speech"
)

func env(m map[string]string) func(string) string {
	return func(k string) string { return m[k] }
}

func TestInputValidation(t *testing.T) {
	in, err := speech.ParseInput("  안녕하세요  ", "ko", "en")
	if err != nil || in.Text != "안녕하세요" || in.Language != "ko" || in.UILang != "en" {
		t.Fatalf("trimmed input = %+v, %v", in, err)
	}
	// JS trim: the BOM is whitespace, U+0085 is not.
	if in, _ := speech.ParseInput(string(rune(0xFEFF))+" hi \n", "en", ""); in.Text != "hi" || in.UILang != "en" {
		t.Errorf("BOM/newline trim = %+v", in)
	}
	if in, err := speech.ParseInput("\u0085", "en", "en"); err != nil || in.Text != "\u0085" {
		t.Errorf("U+0085 = %+v, %v", in, err)
	}
	if _, err := speech.ParseInput(strings.Repeat("a", 4000), "en", "en"); err != nil {
		t.Errorf("4,000 chars rejected: %v", err)
	}
	// 2,000 emoji are 4,000 UTF-16 units; one more ASCII letter is 4,001.
	if _, err := speech.ParseInput(strings.Repeat("😀", 2000), "en", "en"); err != nil {
		t.Errorf("4,000 UTF-16 units rejected: %v", err)
	}
	for name, c := range map[string][3]string{
		"empty":          {"", "en", "en"},
		"blank":          {" \t\n", "en", "en"},
		"4001 ascii":     {strings.Repeat("a", 4001), "en", "en"},
		"4001 utf16":     {strings.Repeat("😀", 2000) + "a", "en", "en"},
		"unknown lang":   {"hello", "invalid", "en"},
		"missing lang":   {"hello", "", "en"},
		"unknown uiLang": {"hello", "en", "fr"},
	} {
		if _, err := speech.ParseInput(c[0], c[1], c[2]); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
	for _, lang := range []string{"en", "ko", "ja", "fr", "es", "zh", "auto"} {
		if _, err := speech.ParseInput("hello", lang, "ko"); err != nil {
			t.Errorf("%s rejected: %v", lang, err)
		}
	}
}

func TestConfigDefaultsAndOverrides(t *testing.T) {
	c, err := speech.LoadConfig(env(nil))
	if err != nil || c != (speech.Config{Model: "gpt-4o-mini-tts", Voice: "marin"}) {
		t.Fatalf("defaults = %+v, %v", c, err)
	}
	c, err = speech.LoadConfig(env(map[string]string{"SPEECH_MODEL": " tts-1-hd ", "SPEECH_VOICE": " coral "}))
	if err != nil || c != (speech.Config{Model: "tts-1-hd", Voice: "coral"}) {
		t.Fatalf("overrides = %+v, %v", c, err)
	}
	// Arbitrary voice ids are accepted (custom voices).
	if c, err := speech.LoadConfig(env(map[string]string{"SPEECH_VOICE": "voice-id"})); err != nil || c.Voice != "voice-id" {
		t.Errorf("custom voice = %+v, %v", c, err)
	}
	for _, model := range []string{" ", "google/gemini-3.8-flash-lite-tts", "openai/one/two", "model other", "model,other", "mo\ndel"} {
		if _, err := speech.LoadConfig(env(map[string]string{"SPEECH_MODEL": model})); !errors.Is(err, speech.ErrConfiguration) {
			t.Errorf("model %q: err = %v", model, err)
		}
	}
}

func TestInvalidVoice(t *testing.T) {
	for _, voice := range []string{" ", strings.Repeat("x", 201), "voice\x00id", "voice\x7fid"} {
		_, err := speech.LoadConfig(env(map[string]string{"SPEECH_VOICE": voice}))
		if !errors.Is(err, speech.ErrConfiguration) {
			t.Errorf("voice %q: err = %v", voice, err)
		}
		if err != nil && strings.TrimSpace(voice) != "" && strings.Contains(err.Error(), voice) {
			t.Errorf("error repeats the value: %v", err)
		}
	}
	if _, err := speech.LoadConfig(env(map[string]string{"SPEECH_VOICE": strings.Repeat("x", 200)})); err != nil {
		t.Errorf("200-char voice rejected: %v", err)
	}
}

// The `openai/` Gateway prefix is not stripped (no legacy paths).
func TestLegacyPrefixRejected(t *testing.T) {
	_, err := speech.LoadConfig(env(map[string]string{"SPEECH_MODEL": "openai/gpt-4o-mini-tts"}))
	if !errors.Is(err, speech.ErrConfiguration) {
		t.Fatalf("err = %v", err)
	}
}

func TestInstructionsNameLanguage(t *testing.T) {
	names := map[string]string{
		"en": "English", "ko": "Korean", "ja": "Japanese",
		"fr": "French", "es": "Spanish", "zh": "Mandarin Chinese",
	}
	for lang, name := range names {
		want := "Read the text aloud in " + name + " with natural native pronunciation, at a clear, relaxed pace."
		if got := speech.Instructions(lang); got != want {
			t.Errorf("%s: %q", lang, got)
		}
	}
	if got := speech.Instructions("auto"); got != "Read the text aloud with natural native pronunciation, at a clear, relaxed pace." {
		t.Errorf("auto: %q", got)
	}
}
