package translate

import (
	"bytes"
	"context"
	"encoding/json/jsontext"
	"encoding/json/v2"
	"errors"
	"fmt"
	"strings"

	"github.com/a-h/templ"
	"github.com/santhosh-tekuri/jsonschema/v6"

	"neotranslate/internal/contract"
	"neotranslate/internal/jsonstream"
	"neotranslate/internal/prompt"
	"neotranslate/internal/web"
)

// fields names the result keys that drive events for one intent.
type fields struct {
	main         string   // streamed as nt-main-delta, closed by nt-main-ready
	text         []string // streamed as nt-text-delta
	alternatives string   // each completed element becomes an AlternativeRow
	skeletonKey  string   // STRINGS key of the alternatives section title
}

var intentFields = map[string]fields{
	"sentence": {main: "main", text: []string{"rationale", "formalityNote"}, alternatives: "alternatives", skeletonKey: "alternatives"},
	"word":     {main: "primaryTranslation", text: []string{"primaryUsageNote"}, alternatives: "alternativeTranslations", skeletonKey: "alternativeTranslations"},
}

// errWrite: the client is gone (a write or flush failed).
var errWrite = errors.New("translate: response write failed")

// errMalformed: the model output is not valid JSON (structured_output).
var errMalformed = errors.New("translate: malformed model output")

// processor turns the model's JSON text into SSE events while it streams.
// The same processor replays a cached document, so a cache hit yields the
// same event sequence as the live run.
type processor struct {
	out    *sseWriter
	c      *contract.Contract
	run    string
	uiLang string
	word   bool
	f      fields
	scan   *jsonstream.Scanner
	doc    strings.Builder
	closed map[string]bool // top-level strings already closed (first one wins)
}

func newProcessor(out *sseWriter, c *contract.Contract, run, intent, uiLang string) *processor {
	return &processor{
		out: out, c: c, run: run, uiLang: uiLang, word: intent == "word",
		f: intentFields[intent], scan: jsonstream.New(), closed: map[string]bool{},
	}
}

// start resets #result-details to the empty skeleton.
func (p *processor) start() bool {
	html, ok := p.render(web.ResultSkeleton(p.c.T(p.uiLang, p.f.skeletonKey)))
	if !ok {
		return false
	}
	return p.out.partial(`<hx-partial hx-target="#result-details" hx-swap="innerHTML">` + html + `</hx-partial>`)
}

// feed scans one delta and emits its events. It returns errMalformed when the
// text is not valid JSON (processing must stop) or errWrite when the client
// is gone.
func (p *processor) feed(delta string) error {
	p.doc.WriteString(delta)
	evs, err := p.scan.Feed(delta)
	if err != nil { // events completed before the error are dropped too
		return errMalformed
	}
	for _, ev := range evs {
		if !p.handle(ev) {
			return errWrite
		}
	}
	return nil
}

// topLevel reports the key of a value directly under the root object.
func topLevel(path jsonstream.Path) (string, bool) {
	if len(path) != 1 || path[0].IsIndex {
		return "", false
	}
	return path[0].Key, true
}

func (p *processor) handle(ev jsonstream.Event) bool {
	if key, ok := topLevel(ev.Path); ok {
		if p.closed[key] {
			return true // duplicate key: the first value already counted
		}
		switch ev.Kind {
		case jsonstream.StringChunk:
			switch {
			case key == p.f.main:
				return p.out.event(evMainDelta, textPayload{Run: p.run, Text: ev.Text})
			case p.isText(key):
				return p.out.event(evTextDelta, fieldTextPayload{Run: p.run, Field: key, Text: ev.Text})
			}
		case jsonstream.StringEnd:
			p.closed[key] = true
			switch key {
			case "sourceLang":
				return p.out.event(evSourceLang, langPayload{Run: p.run, Lang: ev.Text})
			case p.f.main:
				return p.out.event(evMainReady, readyPayload{Run: p.run, Main: prompt.JSTrim(ev.Text)})
			}
		}
		return true
	}
	if ev.Kind == jsonstream.ValueEnd && len(ev.Path) == 2 &&
		!ev.Path[0].IsIndex && ev.Path[0].Key == p.f.alternatives && ev.Path[1].IsIndex {
		return p.alternative(ev.Path[1].Index, ev.Raw)
	}
	return true
}

func (p *processor) isText(key string) bool {
	for _, k := range p.f.text {
		if k == key {
			return true
		}
	}
	return false
}

// alternative emits one completed alternatives[i] row. An element of the
// wrong shape is skipped here; final validation reports it.
func (p *processor) alternative(index int, raw []byte) bool {
	var alt struct {
		Text     string   `json:"text"`
		Note     string   `json:"note"`
		Register []string `json:"register"`
	}
	if json.Unmarshal(raw, &alt) != nil {
		return true
	}
	html, ok := p.render(web.AlternativeRow(index, p.word, alt.Text, alt.Note, alt.Register, p.c.T(p.uiLang, "copy"), p.c.T(p.uiLang, "listen")))
	if !ok {
		return false
	}
	return p.out.partial(`<hx-partial hx-target="#alternatives" hx-swap="beforeend">` + html + `</hx-partial>`)
}

func (p *processor) render(c templ.Component) (string, bool) {
	var b strings.Builder
	if err := c.Render(context.Background(), &b); err != nil {
		p.out.err = err
		return "", false
	}
	return b.String(), true
}

// finish checks the complete document: well-formed JSON without duplicate
// object names (so main-ready, which counts the first value, always matches
// the stored result) and valid against the strict schema. It returns the
// document for the cache.
func (p *processor) finish(schema *jsonschema.Schema) (string, error) {
	if err := p.scan.Close(); err != nil {
		return "", errMalformed
	}
	doc := p.doc.String()
	if !jsontext.Value(doc).IsValid() {
		return "", errMalformed
	}
	inst, err := jsonschema.UnmarshalJSON(strings.NewReader(doc))
	if err != nil {
		return "", errMalformed
	}
	if err := schema.Validate(inst); err != nil {
		return "", fmt.Errorf("%w: schema validation failed", errMalformed)
	}
	return doc, nil
}

// compileSchemas compiles the embedded strict schemas once.
func compileSchemas(c *contract.Contract) (map[string]*jsonschema.Schema, error) {
	comp := jsonschema.NewCompiler()
	out := map[string]*jsonschema.Schema{}
	for intent := range intentFields {
		doc, err := jsonschema.UnmarshalJSON(bytes.NewReader(c.Schemas[intent]))
		if err != nil {
			return nil, fmt.Errorf("translate: schema %s: %w", intent, err)
		}
		url := intent + ".json"
		if err := comp.AddResource(url, doc); err != nil {
			return nil, fmt.Errorf("translate: schema %s: %w", intent, err)
		}
		if out[intent], err = comp.Compile(url); err != nil {
			return nil, fmt.Errorf("translate: schema %s: %w", intent, err)
		}
	}
	return out, nil
}
