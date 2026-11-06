// Package config resolves the translation model settings from the environment.
package config

import (
	"errors"
	"fmt"
	"regexp"
	"slices"
	"strings"

	"neotranslate/internal/contract"
)

// ErrConfiguration marks an invalid deployment setting.
var ErrConfiguration = errors.New("invalid translation configuration")

var (
	reasoningEfforts = []string{"none", "low", "medium"}
	serviceTiers     = []string{"default", "fast"}
	modelID          = regexp.MustCompile(`(?i)^[a-z0-9][a-z0-9._-]*$`)
)

// Translate is the model-facing configuration.
type Translate struct {
	Model       string
	Reasoning   string
	ServiceTier string
}

// Label is a short stable id for cache keys and reports: model:reasoning:tier.
func (t Translate) Label() string { return t.Model + ":" + t.Reasoning + ":" + t.ServiceTier }

// LoadTranslate reads TRANSLATE_MODEL, TRANSLATE_REASONING and
// TRANSLATE_SERVICE_TIER. Defaults: meta.json defaultModel, none, fast.
func LoadTranslate(getenv func(string) string) (Translate, error) {
	def, err := contract.DefaultModel()
	if err != nil {
		return Translate{}, err
	}
	model := strings.TrimSpace(getenv("TRANSLATE_MODEL"))
	if model == "" {
		model = def
	}
	if !modelID.MatchString(model) {
		return Translate{}, fmt.Errorf("%w: TRANSLATE_MODEL must be one exact OpenAI model id", ErrConfiguration)
	}
	reasoning, err := oneOf(getenv, "TRANSLATE_REASONING", reasoningEfforts, "none")
	if err != nil {
		return Translate{}, err
	}
	tier, err := oneOf(getenv, "TRANSLATE_SERVICE_TIER", serviceTiers, "fast")
	if err != nil {
		return Translate{}, err
	}
	return Translate{Model: model, Reasoning: reasoning, ServiceTier: tier}, nil
}

func oneOf(getenv func(string) string, name string, allowed []string, fallback string) (string, error) {
	v := strings.TrimSpace(getenv(name))
	if v == "" {
		v = fallback
	}
	if !slices.Contains(allowed, v) {
		return "", fmt.Errorf("%w: %s must be one of: %s", ErrConfiguration, name, strings.Join(allowed, ", "))
	}
	return v, nil
}
