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
// provider errors) is logged. Runs that reach OpenAI are traced as
// content-free Langfuse generations (internal/telemetry) when configured.
package translate

import (
	"context"
	"errors"
	"mime"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"unicode/utf8"

	lru "github.com/hashicorp/golang-lru/v2"
	"github.com/santhosh-tekuri/jsonschema/v6"

	"neotranslate/internal/config"
	"neotranslate/internal/contract"
	"neotranslate/internal/llm"
	"neotranslate/internal/prompt"
	"neotranslate/internal/telemetry"
)

const (
	cacheSize    = 50
	maxBodyBytes = 64 << 10 // far above the input limits (≈ 4000+1000+3×200+4000 UTF-16 units)
)

// runID is the client's run UUID, echoed in every event.
var runID = regexp.MustCompile(`^[A-Za-z0-9-]{1,64}$`)

// uuid is zod 4's z.uuid() regex (zod/v4/core/regexes.js): RFC 9562
// version 1-8 and variant digits, or the nil and max UUIDs.
var uuid = regexp.MustCompile(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$`)

// triggers are TranslationTrigger (useTranslate.ts); the default is debounce.
var triggers = []string{"debounce", "paste", "enter", "blur", "force", "refinement"}

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
	// tracer is nil (no-op) unless Langfuse is configured.
	tracer *telemetry.Tracer
	// onPrepare is a test hook: a run's learning.Prepare is starting.
	onPrepare func()
}

// Option configures a Server.
type Option func(*Server)

// WithConfigError marks the deployment configuration invalid (cfg is then
// unused): /translate answers each valid request with the localized
// "configuration" nt-error and makes no upstream call.
func WithConfigError(err error) Option { return func(s *Server) { s.cfgErr = err } }

// WithTracer traces each run that reaches OpenAI (never cache hits).
func WithTracer(t *telemetry.Tracer) Option { return func(s *Server) { s.tracer = t } }

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
	run, in, raw, analytics, err := s.parse(w, r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if s.cfgErr != nil {
		s.failStream(w, run, in, raw, llm.KindConfiguration)
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
	p := newProcessor(out, s.c, run, in, raw)
	p.onPrepare = s.onPrepare
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
	// The span ends when the handler returns: after nt-done (or nt-error)
	// has been written and flushed, so export never delays visible output.
	// It records only a classified failure kind; a run whose client left
	// ends without one, as the AI SDK's onAbort does.
	var usage llm.Usage
	var outcome llm.Kind
	var gen *telemetry.Generation
	if s.tracer != nil {
		gen = s.tracer.StartGeneration(ctx, telemetry.NewRuntimeContext(in, s.cfg, s.c.CacheVersion, analytics))
	}
	defer func() {
		cancel()
		gen.End(usage, outcome)
	}()
	fail := func(kind llm.Kind) {
		outcome = kind
		out.event(evError, errorPayload{Run: run, Kind: string(kind), Message: s.c.T(in.UILang, errorKeys[kind])})
	}
	for delta, err := range s.llm.StreamText(ctx, body, &usage) {
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
func (s *Server) failStream(w http.ResponseWriter, run string, in prompt.TranslateInput, raw string, kind llm.Kind) {
	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-cache, no-transform")
	h.Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	out := newSSEWriter(w)
	if newProcessor(out, s.c, run, in, raw).start() {
		out.event(evError, errorPayload{Run: run, Kind: string(kind), Message: s.c.T(in.UILang, errorKeys[kind])})
	}
}

// errBadForm is a content-free parse failure.
var errBadForm = errors.New("invalid translation input: malformed form")

// parse reads the form (urlencoded or multipart), rejects invalid UTF-8 and
// a malformed run id, defaults uiLang to "en" and validates the limits.
// Errors name fields only, never user text.
//
// `text` is the exact textarea value (raw), which learning ranges refer to.
// Form encoding may turn its LF into CRLF (textarea.value never has a CR),
// so CRLF becomes LF. The prompt text is raw trimmed with JS semantics, as
// the TS client trims before it sends.
func (s *Server) parse(w http.ResponseWriter, r *http.Request) (string, prompt.TranslateInput, string, telemetry.Analytics, error) {
	var none telemetry.Analytics
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	var err error
	if mt, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type")); mt == "multipart/form-data" {
		err = r.ParseMultipartForm(maxBodyBytes)
	} else {
		err = r.ParseForm()
	}
	if err != nil {
		return "", prompt.TranslateInput{}, "", none, errBadForm
	}
	form := r.PostForm
	for name, values := range form {
		for _, v := range values {
			if !utf8.ValidString(name) || !utf8.ValidString(v) {
				return "", prompt.TranslateInput{}, "", none, &prompt.FieldError{Field: "form", Reason: "is not valid UTF-8"}
			}
		}
	}
	run := form.Get("run")
	if !runID.MatchString(run) {
		return "", prompt.TranslateInput{}, "", none, &prompt.FieldError{Field: "run", Reason: "is not a valid run id"}
	}
	// The page keeps one hidden refinements input, empty when there are none.
	var refinements []string
	for _, v := range form["refinements"] {
		if v != "" {
			refinements = append(refinements, v)
		}
	}
	raw := strings.ReplaceAll(form.Get("text"), "\r\n", "\n")
	in := prompt.TranslateInput{
		Text:         prompt.JSTrim(raw),
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
		return "", prompt.TranslateInput{}, "", none, err
	}
	analytics, err := parseAnalytics(form, run)
	if err != nil {
		return "", prompt.TranslateInput{}, "", none, err
	}
	return run, in, raw, analytics, nil
}

// parseAnalytics validates the optional analytics fields (useTranslate.ts).
// They reach telemetry only, never the prompt or the cache key. Absent
// fields keep the TS defaults. The run id doubles as the analytics run id
// (TS analyticsRunId) only when it is a UUID; any other accepted run id is
// reported as "".
func parseAnalytics(form url.Values, run string) (telemetry.Analytics, error) {
	bad := func(field, reason string) error { return &prompt.FieldError{Field: field, Reason: reason} }
	a := telemetry.Analytics{
		SessionID:       form.Get("analyticsSessionId"),
		SupersedesRunID: form.Get("supersedesRunId"),
		InputRevision:   -1,
		Trigger:         form.Get("trigger"),
	}
	if uuid.MatchString(run) {
		a.RunID = run
	}
	if a.SessionID != "" && !uuid.MatchString(a.SessionID) {
		return a, bad("analyticsSessionId", "is not a UUID")
	}
	if a.SupersedesRunID != "" && !uuid.MatchString(a.SupersedesRunID) {
		return a, bad("supersedesRunId", "is not a UUID")
	}
	if v := form.Get("inputRevision"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 0 {
			return a, bad("inputRevision", "is not a non-negative integer")
		}
		a.InputRevision = n
	}
	if a.Trigger == "" {
		a.Trigger = "debounce"
	} else if !slices.Contains(triggers, a.Trigger) {
		return a, bad("trigger", "is not supported")
	}
	return a, nil
}
