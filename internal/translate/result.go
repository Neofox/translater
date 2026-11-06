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
	"neotranslate/internal/learning"
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
	closed map[string]bool   // top-level strings already closed (first one wins)
	meta   *web.WordMetaView // word intent: the dictionary fields completed so far
	seen   map[string]bool   // dictionary fields already taken (first one wins)
	// Alternatives (none for a long-form sentence). The newest one,
	// alternatives[altIndex], shows as #alternative-skeleton (altOpen) until
	// it completes and its row replaces the skeleton.
	hideAlts  bool
	altIndex  int
	altOpen   bool
	altLabels [2]string // Copy, Listen
	// Learning (sentence intent). Ranges need every phrase (ordered passes,
	// overlap rejection), so they are one whole-array computation: Prepare
	// starts in a goroutine once main and learningPhrases have both closed,
	// which in schema order is before rationale, alternatives and
	// formalityNote, and runs while they stream. Its rows and ranges are
	// sent just before nt-done because the page opens learning only once
	// the result is done (LearningContext's canOpen). A cache hit
	// recomputes them: ranges depend on the raw text, not the cache key.
	in        prompt.TranslateInput
	raw       string            // the exact textarea value (LF line ends)
	langs     map[string]string // model-reported sourceLang/targetLang
	main      string            // the closed main text, as the page shows it
	mainDone  bool
	phrases   []learning.Phrase
	hasPhrase bool
	learn     chan learnResult // set once Prepare has started
	onPrepare func()           // test hook: Prepare is starting
}

type learnResult struct {
	prepared       learning.Prepared
	ok             bool
	side, language string
}

// newProcessor builds the processor of one run; raw is the exact textarea
// value the learning ranges of an original source refer to.
func newProcessor(out *sseWriter, c *contract.Contract, run string, in prompt.TranslateInput, raw string) *processor {
	intent, uiLang := in.Intent, in.UILang
	p := &processor{
		out: out, c: c, run: run, uiLang: uiLang, word: intent == "word",
		f: intentFields[intent], scan: jsonstream.New(), closed: map[string]bool{},
		hideAlts: intent == "sentence" && prompt.IsLongForm(in.Text), altIndex: -1,
		altLabels: [2]string{c.T(uiLang, "copy"), c.T(uiLang, "listen")},
		in:        in, raw: raw, langs: map[string]string{},
	}
	if p.word {
		p.meta = &web.WordMetaView{T: func(key string) string { return c.T(uiLang, key) }, Streaming: true}
		p.seen = map[string]bool{}
	}
	return p
}

// start resets #result-details to the empty skeleton and, for a word, the
// dictionary to its streaming start.
func (p *processor) start() bool {
	html, ok := p.render(web.ResultSkeleton(p.c.T(p.uiLang, p.f.skeletonKey)))
	if !ok || !p.out.partial(`<hx-partial hx-target="#result-details" hx-swap="innerHTML">`+html+`</hx-partial>`) {
		return false
	}
	return p.wordMeta()
}

// end settles the last alternative, sends the learning rows and ranges and
// renders the complete dictionary without skeletons; it precedes nt-done.
func (p *processor) end() bool {
	if !p.settleAlternative() || !p.learning() {
		return false
	}
	if p.meta == nil {
		return true
	}
	p.meta.Streaming = false
	return p.wordMeta()
}

// wordMeta re-renders the dictionary into #word-meta. A morph keeps the
// blocks already shown (their entry animation does not restart).
func (p *processor) wordMeta() bool {
	if p.meta == nil {
		return true
	}
	html, ok := p.render(web.WordMeta(*p.meta))
	if !ok {
		return false
	}
	return p.out.partial(`<hx-partial hx-target="#word-meta" hx-swap="innerMorph">` + html + `</hx-partial>`)
}

// dictionary takes one completed dictionary value of a word result:
// posList[i] or a top-level field. Values of the wrong shape are skipped
// here; final validation reports them.
func (p *processor) dictionary(ev jsonstream.Event) bool {
	if p.meta == nil || ev.Kind != jsonstream.ValueEnd || len(ev.Path) == 0 || ev.Path[0].IsIndex {
		return true
	}
	m, key := p.meta, ev.Path[0].Key
	if len(ev.Path) == 2 && key == "posList" && ev.Path[1].IsIndex {
		var pos web.POSView
		if p.seen[key] || ev.Path[1].Index != len(m.POS) || json.Unmarshal(ev.Raw, &pos) != nil {
			return true
		}
		m.POS = append(m.POS, pos)
		return p.wordMeta()
	}
	if len(ev.Path) != 1 || p.seen[key] {
		return true
	}
	var err error
	switch key {
	case "posList":
		p.seen[key] = true // later duplicates of the key are ignored
		return true
	case "synonyms":
		err = json.Unmarshal(ev.Raw, &m.Synonyms)
	case "etymology":
		err = json.Unmarshal(ev.Raw, &m.Etymology)
	case "notes":
		err = json.Unmarshal(ev.Raw, &m.Notes)
	case "grammar":
		err = json.Unmarshal(ev.Raw, &m.Grammar)
	case "characters":
		err = json.Unmarshal(ev.Raw, &m.Characters)
	default:
		return true
	}
	p.seen[key] = true
	if err != nil {
		return true
	}
	return p.wordMeta()
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
	if !p.dictionary(ev) {
		return false
	}
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
			if key == "sourceLang" || key == "targetLang" {
				p.langs[key] = ev.Text
			}
			switch key {
			case "sourceLang":
				return p.out.event(evSourceLang, langPayload{Run: p.run, Lang: ev.Text})
			case "targetLang":
				return p.out.event(evTargetLang, langPayload{Run: p.run, Lang: ev.Text})
			case "headword":
				if p.word {
					return p.out.event(evHeadword, textPayload{Run: p.run, Text: ev.Text})
				}
			case p.f.main:
				p.main, p.mainDone = prompt.JSTrim(ev.Text), true
				ok := p.out.event(evMainReady, readyPayload{Run: p.run, Main: p.main})
				p.prepare()
				return ok
			}
		case jsonstream.ValueEnd:
			if key == "learningPhrases" && !p.word {
				p.closed[key] = true
				// A malformed value gets no learning; final validation reports it.
				p.hasPhrase = json.Unmarshal(ev.Raw, &p.phrases) == nil
				p.prepare()
			}
		}
		return true
	}
	if len(ev.Path) >= 2 && !ev.Path[0].IsIndex && ev.Path[0].Key == p.f.alternatives && ev.Path[1].IsIndex {
		return p.alternative(ev)
	}
	return true
}

// prepare starts learning.Prepare once main and learningPhrases have both
// closed. The side follows the model-reported languages, falling back to
// the request's (learningSide). Target ranges are computed on the main text
// as the page displays it: trimmed, the nt-main-ready value.
func (p *processor) prepare() {
	if p.learn != nil || !p.mainDone || !p.hasPhrase {
		return
	}
	source, target := p.in.Source, p.in.Target
	if v, ok := p.langs["sourceLang"]; ok {
		source = v
	}
	if v, ok := p.langs["targetLang"]; ok {
		target = v
	}
	side := learning.Side(source, target, p.uiLang)
	primary, counterpart, language := p.main, p.raw, target
	if side == "source" {
		primary, counterpart, language = p.raw, p.main, source
	}
	ch := make(chan learnResult, 1) // never blocks: an abandoned run leaks nothing
	p.learn = ch
	if p.onPrepare != nil {
		p.onPrepare()
	}
	phrases := p.phrases
	go func() {
		prepared, ok := learning.Prepare(counterpart, primary, phrases)
		ch <- learnResult{prepared, ok, side, language}
	}()
}

// learning waits for Prepare and sends the rows partial, then the ranges.
// Nothing is sent when no phrase resolves (the page then has no learning).
func (p *processor) learning() bool {
	if p.learn == nil {
		return true
	}
	r := <-p.learn
	p.learn = nil
	if !r.ok {
		return true
	}
	html, ok := p.render(web.LearningRows(web.LearningRowsView{
		Run: p.run, Language: r.language, Chunks: r.prepared.Chunks, Partial: r.prepared.Partial,
		T: func(key string) string { return p.c.T(p.uiLang, key) },
	}))
	if !ok || !p.out.partial(`<hx-partial hx-target="#learning-sentence" hx-swap="innerHTML">`+html+`</hx-partial>`) {
		return false
	}
	pairs := func(rs []learning.Range) [][2]int {
		out := make([][2]int, len(rs))
		for i, r := range rs {
			out[i] = [2]int{r.Start, r.End}
		}
		return out
	}
	chunks := make([]learningChunk, len(r.prepared.Chunks))
	for i, c := range r.prepared.Chunks {
		src := make([]learning.Range, len(c.SourceSpans))
		for j, s := range c.SourceSpans {
			src[j] = s.Range
		}
		chunks[i] = learningChunk{S: c.Start, E: c.End, Src: pairs(src), G: pairs(c.GrammarHighlights)}
	}
	return p.out.event(evLearning, learningPayload{
		Run: p.run, Side: r.side, Language: r.language, Chunks: chunks, Partial: r.prepared.Partial,
	})
}

func (p *processor) isText(key string) bool {
	for _, k := range p.f.text {
		if k == key {
			return true
		}
	}
	return false
}

// alternative handles an event under alternatives[i]. The first event of a
// new item settles the previous one and appends the skeleton; the item's
// completion replaces the skeleton with its row at once, so a run that
// stops later keeps every completed row. An element of the wrong shape gets
// no row (its skeleton goes when the next item starts or the run ends);
// final validation reports it.
func (p *processor) alternative(ev jsonstream.Event) bool {
	if p.hideAlts {
		return true
	}
	i := ev.Path[1].Index
	if i > p.altIndex {
		if !p.settleAlternative() {
			return false
		}
		html, ok := p.render(web.AlternativeSkeleton(p.altLabels[0], p.altLabels[1]))
		if !ok || !p.out.partial(`<hx-partial hx-target="#alternatives" hx-swap="beforeend">`+html+`</hx-partial>`) {
			return false
		}
		p.altIndex, p.altOpen = i, true
	}
	if ev.Kind != jsonstream.ValueEnd || len(ev.Path) != 2 || i != p.altIndex {
		return true
	}
	var alt struct {
		Text     string   `json:"text"`
		Note     string   `json:"note"`
		Register []string `json:"register"`
	}
	if json.Unmarshal(ev.Raw, &alt) != nil {
		return true
	}
	html, ok := p.render(web.AlternativeRow(i, p.word, alt.Text, alt.Note, alt.Register, p.altLabels[0], p.altLabels[1]))
	return ok && p.replaceSkeleton(html)
}

// settleAlternative removes the open skeleton of an item that completed
// without a row.
func (p *processor) settleAlternative() bool {
	if !p.altOpen {
		return true
	}
	return p.replaceSkeleton("")
}

// replaceSkeleton swaps the open skeleton for html (a row, or nothing).
func (p *processor) replaceSkeleton(html string) bool {
	p.altOpen = false
	return p.out.partial(`<hx-partial hx-target="#alternative-skeleton" hx-swap="outerHTML">` + html + `</hx-partial>`)
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
