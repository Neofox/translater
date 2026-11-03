// Package translate serves POST /translate, one streaming translation run
// answered as text/event-stream, and POST /warm.
//
// The SSE writer and the event mapping are hand-written: the stream is a few
// fixed frames over net/http (no maintained Go SSE library fits a POST
// response that htmx 4 consumes), and the mapping from JSON paths to events
// is app-specific. Model text is parsed by internal/jsonstream, HTML is
// rendered by templ, final documents are validated by
// santhosh-tekuri/jsonschema and cached in hashicorp/golang-lru.
//
// Nothing about content (source, context, refinements, prompts, output,
// provider errors) is logged.
package translate

import (
	"context"
	"errors"
	"mime"
	"net/http"
	"regexp"
	"unicode/utf8"

	lru "github.com/hashicorp/golang-lru/v2"
	"github.com/santhosh-tekuri/jsonschema/v6"

	"neotranslate/internal/config"
	"neotranslate/internal/contract"
	"neotranslate/internal/llm"
	"neotranslate/internal/prompt"
)

const (
	cacheSize    = 50
	maxBodyBytes = 64 << 10 // far above the input limits (≈ 4000+1000+3×200+4000 UTF-16 units)
)

// runID is the client's run UUID, echoed in every event.
var runID = regexp.MustCompile(`^[A-Za-z0-9-]{1,64}$`)

// errorKeys maps each failure kind to its STRINGS entry, as
// publicTranslationError (src/server/translationError.ts) does.
var errorKeys = map[llm.Kind]string{
	llm.KindConfiguration:      "providerConfigurationFailed",
	llm.KindAuthentication:     "providerAuthenticationFailed",
	llm.KindBudget:             "providerBudgetUnavailable",
	llm.KindRateLimit:          "providerRateLimited",
	llm.KindModelConfiguration: "providerModelInvalid",
	llm.KindStructuredOutput:   "providerStructuredOutputInvalid",
	llm.KindProvider:           "translationFailed",
}

// Server holds the translation dependencies and the result cache.
type Server struct {
	c       *contract.Contract
	cfg     config.Translate
	llm     *llm.Client
	schemas map[string]*jsonschema.Schema
	cache   *lru.Cache[string, string]
	// cfgErr is an invalid TRANSLATE_* setting: every run then ends with a
	// configuration error, as the TS app does per request; the page still
	// works.
	cfgErr error
}

// Option configures a Server.
type Option func(*Server)

// WithConfigError marks the deployment configuration invalid (cfg is then
// unused): /translate answers each valid request with the localized
// "configuration" nt-error and makes no upstream call.
func WithConfigError(err error) Option { return func(s *Server) { s.cfgErr = err } }

// NewServer builds the handlers. The embedded schemas always compile; a
// failure is a build defect and panics.
func NewServer(c *contract.Contract, cfg config.Translate, client *llm.Client, opts ...Option) *Server {
	schemas, err := compileSchemas(c)
	if err != nil {
		panic(err)
	}
	cache, err := lru.New[string, string](cacheSize)
	if err != nil {
		panic(err)
	}
	s := &Server{c: c, cfg: cfg, llm: client, schemas: schemas, cache: cache}
	for _, o := range opts {
		o(s)
	}
	return s
}

// HandleWarm is POST /warm: it lets a cold instance boot before the user
// submits. It makes no OpenAI request.
func (s *Server) HandleWarm(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusNoContent)
}

// HandleTranslate is POST /translate. Invalid input is a 400 before any
// stream starts. Otherwise the response is text/event-stream: the skeleton
// partial, then source-lang, main deltas, main-ready, text deltas and one
// partial per completed alternative, ending with exactly one nt-done or
// nt-error, after which the response closes.
func (s *Server) HandleTranslate(w http.ResponseWriter, r *http.Request) {
	run, in, err := s.parse(w, r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if s.cfgErr != nil {
		s.failStream(w, run, in, llm.KindConfiguration)
		return
	}
	key := prompt.CacheKey(in, s.c.CacheVersion, s.cfg.Label())
	cached, hit := s.cache.Get(key)
	var body []byte
	if !hit {
		if body, err = prompt.BuildRequest(s.c, in, s.cfg); err != nil {
			http.Error(w, "translation request could not be built", http.StatusInternalServerError)
			return
		}
	}

	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-cache, no-transform")
	h.Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	out := newSSEWriter(w)
	p := newProcessor(out, s.c, run, in.Intent, in.UILang)
	if !p.start() {
		return
	}
	if hit {
		if p.feed(cached) == nil && p.end() {
			out.event(evDone, runPayload{Run: run})
		}
		return
	}

	// A failed write ends the handler, and the deferred cancel stops the
	// upstream stream: on hosts that do not cancel r.Context() on client
	// disconnect (Vercel), that is the only disconnect signal.
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	fail := func(kind llm.Kind) {
		out.event(evError, errorPayload{Run: run, Kind: string(kind), Message: s.c.T(in.UILang, errorKeys[kind])})
	}
	for delta, err := range s.llm.StreamText(ctx, body) {
		if err != nil {
			if ctx.Err() != nil || errors.Is(err, context.Canceled) {
				return // the client left; nobody to tell
			}
			fail(llm.Classify(err))
			return
		}
		switch p.feed(delta) {
		case nil:
		case errWrite:
			return
		default:
			fail(llm.KindStructuredOutput)
			return
		}
	}
	if ctx.Err() != nil {
		return
	}
	doc, err := p.finish(s.schemas[in.Intent])
	if err != nil {
		fail(llm.KindStructuredOutput)
		return
	}
	s.cache.Add(key, doc)
	if p.end() {
		out.event(evDone, runPayload{Run: run})
	}
}

// failStream answers a valid request with the skeleton and one nt-error.
func (s *Server) failStream(w http.ResponseWriter, run string, in prompt.TranslateInput, kind llm.Kind) {
	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-cache, no-transform")
	h.Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	out := newSSEWriter(w)
	if newProcessor(out, s.c, run, in.Intent, in.UILang).start() {
		out.event(evError, errorPayload{Run: run, Kind: string(kind), Message: s.c.T(in.UILang, errorKeys[kind])})
	}
}

// errBadForm is a content-free parse failure.
var errBadForm = errors.New("invalid translation input: malformed form")

// parse reads the form (urlencoded or multipart), rejects invalid UTF-8 and
// a malformed run id, defaults uiLang to "en" and validates the limits.
// Errors name fields only, never user text.
func (s *Server) parse(w http.ResponseWriter, r *http.Request) (string, prompt.TranslateInput, error) {
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	var err error
	if mt, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type")); mt == "multipart/form-data" {
		err = r.ParseMultipartForm(maxBodyBytes)
	} else {
		err = r.ParseForm()
	}
	if err != nil {
		return "", prompt.TranslateInput{}, errBadForm
	}
	form := r.PostForm
	for name, values := range form {
		for _, v := range values {
			if !utf8.ValidString(name) || !utf8.ValidString(v) {
				return "", prompt.TranslateInput{}, &prompt.FieldError{Field: "form", Reason: "is not valid UTF-8"}
			}
		}
	}
	run := form.Get("run")
	if !runID.MatchString(run) {
		return "", prompt.TranslateInput{}, &prompt.FieldError{Field: "run", Reason: "is not a valid run id"}
	}
	// The page keeps one hidden refinements input, empty when there are none.
	var refinements []string
	for _, v := range form["refinements"] {
		if v != "" {
			refinements = append(refinements, v)
		}
	}
	in := prompt.TranslateInput{
		Text:         form.Get("text"),
		Source:       form.Get("source"),
		Target:       form.Get("target"),
		Mode:         form.Get("mode"),
		Intent:       form.Get("intent"),
		UILang:       form.Get("uiLang"),
		Context:      form.Get("context"),
		PreviousMain: form.Get("previousMain"),
		Refinements:  refinements,
	}
	if in.UILang == "" {
		in.UILang = "en"
	}
	if err := in.Validate(s.c.Limits); err != nil {
		return "", prompt.TranslateInput{}, err
	}
	return run, in, nil
}
