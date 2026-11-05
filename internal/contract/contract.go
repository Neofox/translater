package contract

import (
	"encoding/json/jsontext"
	"encoding/json/v2"
	"fmt"
	"io/fs"
	"path"
	"regexp"
	"strings"

	"github.com/cbroglie/mustache"

	"neotranslate/shared/translation"
)

// dataFS is the shared contract, embedded from shared/translation.
var dataFS = translation.FS

func init() {
	// Invariant: this package is the only mustache user in the binary, so
	// flipping this process-wide cbroglie global here cannot affect others.
	// Process-wide cbroglie switch: a variable missing from the view is a
	// render error instead of an empty string. Sections stay lenient in the
	// library (a missing section name is falsy), so templates only use
	// sections over booleans that the view always defines.
	mustache.AllowMissingVariables = false
}

// Language is one entry of languages.json.
type Language struct {
	Code       string `json:"code"`
	Label      string `json:"label"`
	PromptName string `json:"promptName"`
}

// Limits is limits.json. Lengths are UTF-16 code units (JS String.length).
type Limits struct {
	MaxInputChars               int     `json:"maxInputChars"`
	InputWarnFraction           float64 `json:"inputWarnFraction"`
	MaxContextChars             int     `json:"maxContextChars"`
	MaxRefinements              int     `json:"maxRefinements"`
	MaxRefinementChars          int     `json:"maxRefinementChars"`
	MaxLearningTranslationChars int     `json:"maxLearningTranslationChars"`
}

// PrefRule is one cookie field. Values may contain nil (JSON null).
type PrefRule struct {
	Key    string
	Values []*string
}

// PrefRules is preferences.json. Fields are in cookie field order. The
// TypeScript-only legacy keys (storage, raw) are ignored.
type PrefRules struct {
	Cookie          string
	Version         int
	MaxAgeSeconds   int
	MaxCookieLength int
	Fields          []PrefRule
}

// Fewshot is one example pair. Assistant is the raw JSON of the assistant
// turn with insignificant whitespace removed (key order and string bytes
// untouched), exactly what the model must see.
type Fewshot struct {
	User      string
	Assistant string
}

// Contract is the loaded shared translation contract.
type Contract struct {
	Strings      map[string]map[string]string
	Languages    []Language
	Limits       Limits
	CacheVersion string
	DefaultModel string
	Prefs        PrefRules
	// Templates by name: path below prompts/ without ".mustache"
	// ("sentence-system", "variants/lean"). Render them with Contract.Render
	// only: plain Template.Render would HTML-escape partials.
	Templates map[string]*mustache.Template
	Fewshots  map[string]Fewshot
	// Schemas holds schemas/<name>.json verbatim, keyed by name
	// ("sentence", "word").
	Schemas map[string][]byte
}

var (
	varTag     = regexp.MustCompile(`\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}`)
	partialTag = regexp.MustCompile(`\{\{>\s*([^\s}]+)\s*\}\}`)
)

// rawify turns every {{name}} into {{{name}}}. cbroglie's forceRaw flag does
// not reach partials (they are re-parsed with escaping on), so the prompt
// text is made unescaped at the source level. Templates never use {{{ }}}.
func rawify(s string) string { return varTag.ReplaceAllString(s, "{{{$1}}}") }

// partials resolves partial names strictly: unlike mustache.StaticProvider a
// missing partial is an error, not an empty string.
type partials map[string]string

func (p partials) Get(name string) (string, error) {
	s, ok := p[name]
	if !ok {
		return "", fmt.Errorf("contract: missing partial %q", name)
	}
	return s, nil
}

// Load decodes the embedded contract and parses every template.
func Load() (*Contract, error) {
	c := &Contract{}
	if err := readJSON("i18n/strings.json", &c.Strings); err != nil {
		return nil, err
	}
	if err := readJSON("languages.json", &c.Languages); err != nil {
		return nil, err
	}
	if err := readJSON("limits.json", &c.Limits); err != nil {
		return nil, err
	}
	var meta struct {
		CacheVersion string `json:"cacheVersion"`
		DefaultModel string `json:"defaultModel"`
	}
	if err := readJSON("meta.json", &meta); err != nil {
		return nil, err
	}
	c.CacheVersion, c.DefaultModel = meta.CacheVersion, meta.DefaultModel
	if c.CacheVersion == "" || c.DefaultModel == "" {
		return nil, fmt.Errorf("contract: meta.json incomplete")
	}
	var err error
	if c.Prefs, err = loadPrefRules(); err != nil {
		return nil, err
	}
	if err := c.loadTemplates(); err != nil {
		return nil, err
	}
	if err := c.loadFewshots(); err != nil {
		return nil, err
	}
	if err := c.loadSchemas(); err != nil {
		return nil, err
	}
	return c, nil
}

// DefaultModel is meta.json's defaultModel without loading templates.
func DefaultModel() (string, error) {
	var meta struct {
		DefaultModel string `json:"defaultModel"`
	}
	if err := readJSON("meta.json", &meta); err != nil {
		return "", err
	}
	return meta.DefaultModel, nil
}

// T returns the UI string for key in uiLang, or the key itself when absent.
func (c *Contract) T(uiLang, key string) string {
	if s, ok := c.Strings[uiLang][key]; ok {
		return s
	}
	return key
}

// Render renders the named template with view (map[string]any of strings and
// booleans) and strips exactly one trailing "\n" (shared README, rule 3).
// Text is emitted unescaped: "<", "&" and quotes stay verbatim. A variable
// missing from view or a missing partial is an error.
func (c *Contract) Render(name string, view map[string]any) (string, error) {
	t, ok := c.Templates[name]
	if !ok {
		return "", fmt.Errorf("contract: unknown template %q", name)
	}
	out, err := t.Render(view)
	if err != nil {
		return "", fmt.Errorf("contract: render %q: %w", name, err)
	}
	return strings.TrimSuffix(out, "\n"), nil
}

func readJSON(name string, v any) error {
	b, err := dataFS.ReadFile(name)
	if err != nil {
		return err
	}
	if err := json.Unmarshal(b, v); err != nil {
		return fmt.Errorf("contract: %s: %w", name, err)
	}
	return nil
}

func loadPrefRules() (PrefRules, error) {
	b, err := dataFS.ReadFile("preferences.json")
	if err != nil {
		return PrefRules{}, err
	}
	var raw struct {
		Cookie          string         `json:"cookie"`
		Version         int            `json:"version"`
		MaxAgeSeconds   int            `json:"maxAgeSeconds"`
		MaxCookieLength int            `json:"maxCookieLength"`
		Rules           jsontext.Value `json:"rules"`
	}
	if err := json.Unmarshal(b, &raw); err != nil {
		return PrefRules{}, fmt.Errorf("contract: preferences.json: %w", err)
	}
	out := PrefRules{Cookie: raw.Cookie, Version: raw.Version, MaxAgeSeconds: raw.MaxAgeSeconds, MaxCookieLength: raw.MaxCookieLength}
	// Rule order is the cookie field order, so walk the object in order.
	dec := jsontext.NewDecoder(strings.NewReader(string(raw.Rules)))
	if _, err := dec.ReadToken(); err != nil { // '{'
		return PrefRules{}, err
	}
	for dec.PeekKind() != '}' {
		tok, err := dec.ReadToken()
		if err != nil {
			return PrefRules{}, err
		}
		key := tok.String() // tokens are voided by the next decoder call
		var rule struct {
			Values []*string `json:"values"`
		}
		if err := json.UnmarshalDecode(dec, &rule); err != nil {
			return PrefRules{}, fmt.Errorf("contract: preferences.json rule %s: %w", key, err)
		}
		out.Fields = append(out.Fields, PrefRule{Key: key, Values: rule.Values})
	}
	return out, nil
}

func (c *Contract) loadTemplates() error {
	raw := map[string]string{}
	err := fs.WalkDir(dataFS, "prompts", func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(p, ".mustache") {
			return err
		}
		b, err := dataFS.ReadFile(p)
		if err != nil {
			return err
		}
		name := strings.TrimSuffix(strings.TrimPrefix(p, "prompts/"), ".mustache")
		raw[name] = string(b)
		return nil
	})
	if err != nil {
		return err
	}
	t, err := parseTemplates(raw)
	if err != nil {
		return err
	}
	c.Templates = t
	return nil
}

// forbiddenTags are mustache constructs the contract never uses (shared
// README rule 5). Triple/ampersand tags would collide with rawify, and
// delimiter changes would defeat its regex.
var forbiddenTags = []string{"{{{", "{{&", "{{="}

// parseTemplates validates and parses template sources keyed by name.
func parseTemplates(sources map[string]string) (map[string]*mustache.Template, error) {
	raw := make(map[string]string, len(sources))
	for name, src := range sources {
		for _, tag := range forbiddenTags {
			if strings.Contains(src, tag) {
				return nil, fmt.Errorf("contract: template %q uses forbidden tag %q (only variables, sections, comments and partials are allowed)", name, tag)
			}
		}
		raw[name] = rawify(src)
	}
	for name, src := range raw {
		for _, m := range partialTag.FindAllStringSubmatch(src, -1) {
			if _, ok := raw[m[1]]; !ok {
				return nil, fmt.Errorf("contract: template %q references missing partial %q", name, m[1])
			}
		}
	}
	out := make(map[string]*mustache.Template, len(raw))
	for name, src := range raw {
		t, err := mustache.ParseStringPartials(src, partials(raw))
		if err != nil {
			return nil, fmt.Errorf("contract: parse template %q: %w", name, err)
		}
		out[name] = t
	}
	return out, nil
}

func (c *Contract) loadFewshots() error {
	c.Fewshots = map[string]Fewshot{}
	ents, err := dataFS.ReadDir("fewshots")
	if err != nil {
		return err
	}
	for _, e := range ents {
		if !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		b, err := dataFS.ReadFile(path.Join("fewshots", e.Name()))
		if err != nil {
			return err
		}
		var f struct {
			User      string         `json:"user"`
			Assistant jsontext.Value `json:"assistant"`
		}
		if err := json.Unmarshal(b, &f); err != nil {
			return fmt.Errorf("contract: fewshot %s: %w", e.Name(), err)
		}
		// Compact removes insignificant whitespace only; strings stay verbatim.
		if err := f.Assistant.Compact(); err != nil {
			return fmt.Errorf("contract: fewshot %s: %w", e.Name(), err)
		}
		c.Fewshots[strings.TrimSuffix(e.Name(), ".json")] = Fewshot{User: f.User, Assistant: string(f.Assistant)}
	}
	if len(c.Fewshots) == 0 {
		return fmt.Errorf("contract: no few-shots")
	}
	return nil
}

func (c *Contract) loadSchemas() error {
	c.Schemas = map[string][]byte{}
	for _, name := range []string{"sentence", "word"} {
		b, err := dataFS.ReadFile("schemas/" + name + ".json")
		if err != nil {
			return err
		}
		if !jsontext.Value(b).IsValid() {
			return fmt.Errorf("contract: schema %s is not valid JSON", name)
		}
		c.Schemas[name] = b
	}
	return nil
}
