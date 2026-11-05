package prompt

import (
	"encoding/json/jsontext"
	"fmt"
	"maps"
	"slices"
	"strings"

	"github.com/openai/openai-go/v3"
	"github.com/openai/openai-go/v3/responses"
	"github.com/openai/openai-go/v3/shared"

	"neotranslate/internal/config"
	"neotranslate/internal/contract"
)

func promptName(code string) string {
	if n, ok := promptNames[code]; ok {
		return n
	}
	return code
}

// Flags are the input-derived template variables of
// shared/translation/README.md ("Variables"), everything except the three
// derived strings that View renders from templates.
func Flags(in TranslateInput) map[string]any {
	kr := in.Source == "ko" || in.Target == "ko"
	isPolish := in.Source == in.Target
	pairInvolvesForeign := (in.Source != "en" && in.Source != "auto") || in.Target != "en"
	metaLang := "ENGLISH"
	if in.UILang == "ko" {
		metaLang = "KOREAN"
	}
	return map[string]any{
		"source":                in.Source,
		"target":                in.Target,
		"uiLang":                in.UILang,
		"sourceName":            promptName(in.Source),
		"targetName":            promptName(in.Target),
		"uiLangName":            promptName(in.UILang),
		"metaLang":              metaLang,
		"uiKo":                  in.UILang == "ko",
		"isPolish":              isPolish,
		"kr":                    kr,
		"autoSource":            in.Source == "auto",
		"intentSentence":        in.Intent == "sentence",
		"modeFriends":           in.Mode == "friends",
		"modeCasual":            in.Mode == "casual",
		"modeProfessional":      in.Mode == "professional",
		"modeUpper":             strings.ToUpper(in.Mode), // modes are ASCII
		"populateFormalityNote": kr && in.Target == "ko" && in.Mode != "friends",
		"detailReminder":        pairInvolvesForeign && !isPolish,
		"manyAlternatives":      kr || in.Target == "ja",
	}
}

// derived lists the README's derived strings in rendering order; each
// template is rendered with the view built so far, then added to it.
var derived = []struct{ name, template string }{
	{"toneGuidance", "tone"},
	{"koreanRegisterGuidance", "korean-register"},
	{"wordBand", "word-band"},
}

// View is the full template view: Flags plus the derived strings.
func View(c *contract.Contract, in TranslateInput) (map[string]any, error) {
	v := Flags(in)
	for _, d := range derived {
		s, err := c.Render(d.template, v)
		if err != nil {
			return nil, err
		}
		v[d.name] = s
	}
	return v, nil
}

// fewshotName selects the example pair (README "Few-shots").
func fewshotName(in TranslateInput) string {
	ui := "en"
	if in.UILang == "ko" {
		ui = "ko"
	}
	isPolish := in.Source == in.Target
	if in.Intent == "word" {
		if isPolish {
			return "word-polish-" + ui
		}
		return "word-" + in.Mode + "-" + ui
	}
	switch {
	case isPolish:
		return "sentence-polish-" + ui
	case in.Target == in.UILang && in.Source != in.UILang:
		return "sentence-reading-" + ui
	default:
		return "sentence-translate-" + ui
	}
}

func developer(text string) responses.ResponseInputItemUnionParam {
	return responses.ResponseInputItemUnionParam{OfMessage: &responses.EasyInputMessageParam{
		Role:    responses.EasyInputMessageRoleDeveloper,
		Content: responses.EasyInputMessageContentUnionParam{OfString: openai.String(text)},
	}}
}

func user(parts ...responses.ResponseInputTextParam) responses.ResponseInputItemUnionParam {
	list := make(responses.ResponseInputMessageContentListParam, len(parts))
	for i := range parts {
		list[i] = responses.ResponseInputContentUnionParam{OfInputText: &parts[i]}
	}
	return responses.ResponseInputItemUnionParam{OfMessage: &responses.EasyInputMessageParam{
		Role:    responses.EasyInputMessageRoleUser,
		Content: responses.EasyInputMessageContentUnionParam{OfInputItemContentList: list},
	}}
}

// Production is the app's own prompt; Variants lists every prompt BuildVariant
// accepts. The others are eval-only alternative sentence system messages
// (shared/translation/prompts/variants): "lean", and "lean-nochars" with
// leanCharacters false.
const Production = "production"

var Variants = []string{Production, "lean", "lean-nochars"}

// systemMessage renders input[1]. A variant replaces only the sentence
// system message: word intent ignores it, as the evals always have.
func systemMessage(c *contract.Contract, in TranslateInput, view map[string]any, variant string) (string, error) {
	switch {
	case !slices.Contains(Variants, variant):
		return "", fmt.Errorf("prompt: unknown variant %q", variant)
	case variant == Production || in.Intent != "sentence":
		return c.Render(in.Intent+"-system", view)
	}
	v := maps.Clone(view)
	v["leanCharacters"] = variant == "lean"
	return c.Render("variants/lean", v)
}

// BuildRequest returns the streaming POST /v1/responses body for in
// (README "Request body"; fixtures/requests.json are the golden bodies).
// It validates in first. The body is built from openai-go typed params;
// "stream" is an extra field because the SDK adds it only inside
// NewStreaming, and the caller sends these bytes verbatim.
func BuildRequest(c *contract.Contract, in TranslateInput, cfg config.Translate) ([]byte, error) {
	return BuildVariant(c, in, cfg, Production)
}

// BuildVariant is BuildRequest with an eval prompt variant (one of
// Variants; fixtures/variants.json are its golden bodies).
func BuildVariant(c *contract.Contract, in TranslateInput, cfg config.Translate, variant string) ([]byte, error) {
	if err := in.Validate(c.Limits); err != nil {
		return nil, err
	}
	view, err := View(c, in)
	if err != nil {
		return nil, err
	}
	render := func(name string) (string, error) { return c.Render(name, view) }
	languageRule, err := render("language-rule")
	if err != nil {
		return nil, err
	}
	system, err := systemMessage(c, in, view, variant)
	if err != nil {
		return nil, err
	}
	reminder, err := render(in.Intent + "-reminder")
	if err != nil {
		return nil, err
	}
	fs, ok := c.Fewshots[fewshotName(in)]
	if !ok {
		return nil, fmt.Errorf("prompt: missing few-shot %q", fewshotName(in))
	}
	schemaName := in.Intent // "sentence" | "word", validated above
	// The schema goes out as its original bytes: the model writes fields in
	// schema key order, and decoding into the SDK's map[string]any field
	// would re-encode it alphabetically (main after alternatives, the
	// languages last), delaying main by seconds and changing the output.
	schema := jsontext.Value(c.Schemas[schemaName])
	if !schema.IsValid() {
		return nil, fmt.Errorf("prompt: schema %s is not valid JSON", schemaName)
	}
	format := responses.ResponseFormatTextJSONSchemaConfigParam{
		Name:   schemaName + "_translation",
		Strict: openai.Bool(true),
	}
	format.SetExtraFields(map[string]any{"schema": schema})

	reasoning := shared.ReasoningParam{Effort: shared.ReasoningEffort(cfg.Reasoning)}
	if cfg.Reasoning != "none" {
		reasoning.Summary = shared.ReasoningSummaryDetailed
	}

	params := responses.ResponseNewParams{
		Model: cfg.Model,
		Input: responses.ResponseNewParamsInputUnion{OfInputItemList: responses.ResponseInputParam{
			developer(languageRule),
			developer(system),
			user(responses.ResponseInputTextParam{Text: fs.User}),
			{OfMessage: &responses.EasyInputMessageParam{
				Role:    responses.EasyInputMessageRoleAssistant,
				Content: responses.EasyInputMessageContentUnionParam{OfString: openai.String(fs.Assistant)},
			}},
			// Stable reminder ends the cacheable prefix; live text follows.
			user(
				responses.ResponseInputTextParam{
					Text:                  reminder,
					PromptCacheBreakpoint: responses.NewResponseInputTextPromptCacheBreakpointParam(),
				},
				responses.ResponseInputTextParam{Text: LiveInput(in)},
			),
		}},
		Text: responses.ResponseTextConfigParam{Format: responses.ResponseFormatTextConfigUnionParam{
			OfJSONSchema: &format,
		}},
		Store:          openai.Bool(false),
		ServiceTier:    responses.ResponseNewParamsServiceTier(cfg.ServiceTier),
		Include:        []responses.ResponseIncludable{responses.ResponseIncludableReasoningEncryptedContent},
		PromptCacheKey: openai.String(PromptCacheKey(in, c.CacheVersion)),
		PromptCacheOptions: responses.ResponseNewParamsPromptCacheOptions{
			Mode: "explicit",
			Ttl:  "30m",
		},
		Reasoning: reasoning,
	}
	params.SetExtraFields(map[string]any{"stream": true})
	return params.MarshalJSON()
}
