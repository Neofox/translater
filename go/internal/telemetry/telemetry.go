// Package telemetry sends optional, content-free Langfuse generation traces
// over OTLP/HTTP, the Go port of src/server/telemetry.ts.
//
// It is built on the official OpenTelemetry Go SDK (sdktrace) and its
// otlptracehttp exporter; only the attribute mapping is app-specific.
//
// Telemetry is off, at zero cost (a nil *Tracer), unless both
// LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY are non-blank. Each translation
// that reaches OpenAI becomes one "translation" generation span whose
// attributes are exactly: the generation markers, the requested model, the
// reported token usage and the SAFE_TRANSLATION_CONTEXT_KEYS allowlist
// (RuntimeContext). Source text, context, refinements, prompts, outputs, raw
// bodies, provider errors and provider metadata never reach a span: a failure
// is recorded as its classified llm.Kind only.
//
// Spans are exported synchronously when they end (sdktrace.WithSyncer, the TS
// exportMode:'immediate'), because a Vercel Go function has no waitUntil; the
// handler ends the span after nt-done has been flushed. Initialisation and
// export failures are never fatal and are warned once, without the error
// text (an OTLP error can carry the receiver's response body).
package telemetry

import (
	"context"
	"encoding/base64"
	"log"
	"strings"
	"sync"
	"time"
	"unicode/utf16"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"

	"neotranslate/internal/config"
	"neotranslate/internal/llm"
	"neotranslate/internal/prompt"
)

const (
	defaultBaseURL = "https://cloud.langfuse.com"
	tracesPath     = "/api/public/otel/v1/traces"
	exportTimeout  = 2 * time.Second
	spanName       = "translation"
	metadataPrefix = "langfuse.observation.metadata."
)

// Aborted is the outcome of a run whose client left (a superseded or
// cancelled translation). It is a fixed status message, like the llm kinds.
const Aborted llm.Kind = "aborted"

// Tracer creates generation spans. A nil *Tracer is the disabled tracer:
// every method is a no-op.
type Tracer struct {
	tracer trace.Tracer
	warn   sync.Once
}

// Setup returns the Langfuse tracer, or nil (disabled) unless both Langfuse
// keys are set. It never fails: an exporter that cannot be built is warned
// once and leaves telemetry disabled. The provider is not registered
// globally, so nothing else (speech) is ever traced.
func Setup(getenv func(string) string) *Tracer {
	pk := strings.TrimSpace(getenv("LANGFUSE_PUBLIC_KEY"))
	sk := strings.TrimSpace(getenv("LANGFUSE_SECRET_KEY"))
	if pk == "" || sk == "" {
		return nil
	}
	base := strings.TrimRight(strings.TrimSpace(getenv("LANGFUSE_BASE_URL")), "/")
	if base == "" {
		base = defaultBaseURL
	}
	t := &Tracer{}
	exp, err := otlptracehttp.New(context.Background(),
		otlptracehttp.WithEndpointURL(base+tracesPath),
		otlptracehttp.WithHeaders(map[string]string{
			"Authorization":                "Basic " + base64.StdEncoding.EncodeToString([]byte(pk+":"+sk)),
			"x-langfuse-ingestion-version": "4",
		}),
		otlptracehttp.WithTimeout(exportTimeout),
		// A failed export is dropped, never retried (as translations are).
		otlptracehttp.WithRetry(otlptracehttp.RetryConfig{Enabled: false}),
	)
	if err != nil {
		t.warnOnce("initialization failed; translations will continue untraced")
		return nil
	}
	t.tracer = newProvider(&quietExporter{SpanExporter: exp, t: t}, getenv).Tracer("neotranslate/translate")
	return t
}

// newProvider builds the synchronous provider around exp.
func newProvider(exp sdktrace.SpanExporter, getenv func(string) string) *sdktrace.TracerProvider {
	var attrs []attribute.KeyValue
	if v := strings.TrimSpace(getenv("LANGFUSE_TRACING_ENVIRONMENT")); v != "" {
		attrs = append(attrs, attribute.String("langfuse.environment", v))
	}
	if v := strings.TrimSpace(getenv("LANGFUSE_RELEASE")); v != "" {
		attrs = append(attrs, attribute.String("langfuse.release", v))
	}
	return sdktrace.NewTracerProvider(
		sdktrace.WithSyncer(exp),
		sdktrace.WithResource(resource.NewSchemaless(attrs...)),
		sdktrace.WithSampler(sdktrace.AlwaysSample()),
	)
}

func (t *Tracer) warnOnce(message string) {
	t.warn.Do(func() { log.Printf("[langfuse] %s", message) })
}

// quietExporter turns export errors into one content-free warning, so they
// never reach otel.Handle (which would log the error text).
type quietExporter struct {
	sdktrace.SpanExporter
	t *Tracer
}

func (q *quietExporter) ExportSpans(ctx context.Context, spans []sdktrace.ReadOnlySpan) error {
	if err := q.SpanExporter.ExportSpans(ctx, spans); err != nil {
		q.t.warnOnce("trace export failed; translations will continue")
	}
	return nil
}

// RuntimeContext is the safe allowlist of translationRuntimeContext
// (SAFE_TRANSLATION_CONTEXT_KEYS): enumerations, counts, buckets and
// client-generated ids only.
type RuntimeContext struct {
	Intent             string
	Mode               string
	SourceLanguage     string
	TargetLanguage     string
	UILanguage         string
	HasContext         bool
	RefinementCount    int
	RequestKind        string // initial | context | refinement
	InputLengthBucket  string // 0 | 1-24 | 25-100 | 101-500 | 501-2000 | 2001+
	IsPolish           bool
	PromptVersion      string
	RequestedModel     string
	ReasoningEffort    string
	ServiceTier        string
	Trigger            string
	AnalyticsSessionID string
	ClientRunID        string
	SupersedesRunID    string
	InputRevision      int
}

// Analytics are the validated client analytics form fields. Absent fields
// keep the TS defaults ("" ids, revision -1, trigger "debounce").
type Analytics struct {
	SessionID       string
	RunID           string
	SupersedesRunID string
	InputRevision   int
	Trigger         string
}

// NewRuntimeContext ports translationRuntimeContext.
func NewRuntimeContext(in prompt.TranslateInput, cfg config.Translate, promptVersion string, a Analytics) RuntimeContext {
	kind := "initial"
	switch {
	case len(in.Refinements) > 0:
		kind = "refinement"
	case in.Context != "":
		kind = "context"
	}
	return RuntimeContext{
		Intent:             in.Intent,
		Mode:               in.Mode,
		SourceLanguage:     in.Source,
		TargetLanguage:     in.Target,
		UILanguage:         in.UILang,
		HasContext:         in.Context != "",
		RefinementCount:    len(in.Refinements),
		RequestKind:        kind,
		InputLengthBucket:  LengthBucket(utf16Len(strings.TrimSpace(in.Text))),
		IsPolish:           in.Source == in.Target,
		PromptVersion:      promptVersion,
		RequestedModel:     cfg.Model,
		ReasoningEffort:    cfg.Reasoning,
		ServiceTier:        cfg.ServiceTier,
		Trigger:            a.Trigger,
		AnalyticsSessionID: a.SessionID,
		ClientRunID:        a.RunID,
		SupersedesRunID:    a.SupersedesRunID,
		InputRevision:      a.InputRevision,
	}
}

// LengthBucket is characterCountBucket (translationDimensions.ts).
func LengthBucket(n int) string {
	switch {
	case n == 0:
		return "0"
	case n <= 24:
		return "1-24"
	case n <= 100:
		return "25-100"
	case n <= 500:
		return "101-500"
	case n <= 2000:
		return "501-2000"
	}
	return "2001+"
}

// utf16Len is JS String.prototype.length (the TS client sends trimmed text).
func utf16Len(s string) int {
	n := 0
	for _, r := range s {
		n += utf16.RuneLen(r)
	}
	return n
}

func (rc RuntimeContext) attributes() []attribute.KeyValue {
	m := func(k string) attribute.Key { return attribute.Key(metadataPrefix + k) }
	return []attribute.KeyValue{
		m("intent").String(rc.Intent),
		m("mode").String(rc.Mode),
		m("sourceLanguage").String(rc.SourceLanguage),
		m("targetLanguage").String(rc.TargetLanguage),
		m("uiLanguage").String(rc.UILanguage),
		m("hasContext").Bool(rc.HasContext),
		m("refinementCount").Int(rc.RefinementCount),
		m("requestKind").String(rc.RequestKind),
		m("inputLengthBucket").String(rc.InputLengthBucket),
		m("isPolish").Bool(rc.IsPolish),
		m("promptVersion").String(rc.PromptVersion),
		m("requestedModel").String(rc.RequestedModel),
		m("reasoningEffort").String(rc.ReasoningEffort),
		m("serviceTier").String(rc.ServiceTier),
		m("trigger").String(rc.Trigger),
		m("analyticsSessionId").String(rc.AnalyticsSessionID),
		m("clientRunId").String(rc.ClientRunID),
		m("supersedesRunId").String(rc.SupersedesRunID),
		m("inputRevision").Int(rc.InputRevision),
	}
}

// Generation is one in-flight translation span. A nil *Generation (from the
// disabled tracer) ignores End.
type Generation struct {
	span trace.Span
}

// StartGeneration opens the "translation" generation span for one OpenAI
// run. Call it only for runs that reach OpenAI (never for cache hits).
func (t *Tracer) StartGeneration(ctx context.Context, rc RuntimeContext) *Generation {
	if t == nil || t.tracer == nil {
		return nil
	}
	attrs := append([]attribute.KeyValue{
		attribute.String("langfuse.observation.type", "generation"),
		attribute.String("langfuse.trace.name", spanName),
		attribute.String("gen_ai.request.model", rc.RequestedModel),
	}, rc.attributes()...)
	_, span := t.tracer.Start(ctx, spanName, trace.WithAttributes(attrs...))
	return &Generation{span: span}
}

// End records the token usage the provider reported (omitted when none was)
// and the outcome, then ends and exports the span. kind is "" on success,
// a classified llm.Kind on failure, or Aborted when the client left; it is
// the only failure detail recorded (as the span status message).
func (g *Generation) End(usage llm.Usage, kind llm.Kind) {
	if g == nil {
		return
	}
	if usage != (llm.Usage{}) {
		g.span.SetAttributes(
			attribute.Int64("gen_ai.usage.input_tokens", usage.InputTokens),
			attribute.Int64("gen_ai.usage.output_tokens", usage.OutputTokens),
		)
	}
	if kind != "" {
		g.span.SetStatus(codes.Error, string(kind))
	}
	g.span.End()
}
