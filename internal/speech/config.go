// Package speech serves POST /speech: one OpenAI text-to-speech request per
// Listen tap, returned as validated mono PCM16. Speech never logs and never
// registers telemetry: input text, provider errors and audio stay out of
// every log.
package speech

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
	"unicode/utf16"

	"neotranslate/internal/prompt"
)

// ErrConfiguration marks an invalid SPEECH_MODEL or SPEECH_VOICE.
var ErrConfiguration = errors.New("invalid speech configuration")

// errInput is a content-free input failure.
var errInput = errors.New("invalid speech input")

const (
	defaultModel = "gpt-4o-mini-tts"
	defaultVoice = "marin"
	// MaxChars is the input limit in UTF-16 code units (JS length).
	MaxChars      = 4000
	maxVoiceChars = 200
)

var modelID = regexp.MustCompile(`(?i)^[a-z0-9][a-z0-9._-]*$`)

// OpenAI speech has no language parameter; the voice instructions carry it so
// short or mixed-script text is still read with native pronunciation. "auto"
// names no language.
var languageNames = map[string]string{
	"en": "English", "ko": "Korean", "ja": "Japanese",
	"fr": "French", "es": "Spanish", "zh": "Mandarin Chinese", "auto": "",
}

// Config is the deployment's speech model and voice.
type Config struct {
	Model, Voice string
}

// LoadConfig reads SPEECH_MODEL (one exact OpenAI model id, default
// gpt-4o-mini-tts) and SPEECH_VOICE (any voice id, default marin). Unset
// variables take the default; values are trimmed, and a set value that trims
// to nothing is invalid. Errors name the variable only.
func LoadConfig(getenv func(string) string) (Config, error) {
	model := strings.TrimSpace(getenv("SPEECH_MODEL"))
	if getenv("SPEECH_MODEL") == "" {
		model = defaultModel
	}
	if !modelID.MatchString(model) {
		return Config{}, fmt.Errorf("%w: SPEECH_MODEL must be one exact OpenAI speech model id", ErrConfiguration)
	}
	voice := defaultVoice
	if raw := getenv("SPEECH_VOICE"); raw != "" {
		voice = strings.TrimSpace(raw)
		if voice == "" || utf16Len(voice) > maxVoiceChars || strings.ContainsFunc(voice, func(r rune) bool { return r < 32 || r == 127 }) {
			return Config{}, fmt.Errorf("%w: SPEECH_VOICE must be a nonempty voice identifier", ErrConfiguration)
		}
	}
	return Config{Model: model, Voice: voice}, nil
}

// Instructions names the language for the voice (gpt-4o-mini-tts and newer;
// tts-1 ignores instructions).
func Instructions(lang string) string {
	if name := languageNames[lang]; name != "" {
		return "Read the text aloud in " + name + " with natural native pronunciation, at a clear, relaxed pace."
	}
	return "Read the text aloud with natural native pronunciation, at a clear, relaxed pace."
}

// Input is one validated Listen request.
type Input struct {
	Text, Language, UILang string
}

// ParseInput trims text like JS String.prototype.trim and requires 1–4,000
// UTF-16 code units, a known language (or "auto") and uiLang en/ko (empty
// means en). The error never contains the text.
func ParseInput(text, language, uiLang string) (Input, error) {
	text = prompt.JSTrim(text)
	if uiLang == "" {
		uiLang = "en"
	}
	_, known := languageNames[language]
	if text == "" || utf16Len(text) > MaxChars || !known || (uiLang != "en" && uiLang != "ko") {
		return Input{}, errInput
	}
	return Input{Text: text, Language: language, UILang: uiLang}, nil
}

// utf16Len is JS String.prototype.length.
func utf16Len(s string) int {
	n := 0
	for _, r := range s {
		n += utf16.RuneLen(r)
	}
	return n
}
