package telemetry

import (
	"bytes"
	"context"
	"encoding/base64"
	"io"
	"log"
	"maps"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"go.opentelemetry.io/otel/codes"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	collectorpb "go.opentelemetry.io/proto/otlp/collector/trace/v1"
	"google.golang.org/protobuf/proto"

	"neotranslate/internal/config"
	"neotranslate/internal/llm"
	"neotranslate/internal/prompt"
)

const canary = "nt-canary-5d1e"

func env(vars map[string]string) func(string) string {
	return func(k string) string { return vars[k] }
}

// memTracer is an enabled tracer exporting to memory.
func memTracer(t *testing.T, vars map[string]string) (*Tracer, *tracetest.InMemoryExporter) {
	t.Helper()
	exp := tracetest.NewInMemoryExporter()
	return &Tracer{tracer: newProvider(exp, env(vars)).Tracer("test")}, exp
}

func canaryInput() prompt.TranslateInput {
	return prompt.TranslateInput{
		Text: "  source " + canary + "  ", Source: "en", Target: "ko", Mode: "casual",
		Intent: "sentence", UILang: "en", Context: "context " + canary,
		PreviousMain: "previous " + canary, Refinements: []string{"make it softer", "custom " + canary},
	}
}

var testCfg = config.Translate{Model: "gpt-6.1-terra", Reasoning: "none", ServiceTier: "fast"}

func analytics() Analytics {
	return Analytics{
		SessionID: "11111111-1111-4111-8111-111111111111", RunID: "22222222-2222-4222-8222-222222222222",
		SupersedesRunID: "33333333-3333-4333-8333-333333333333", InputRevision: 3, Trigger: "refinement",
	}
}

// safeContextKeys is the runtime-context allowlist: the only metadata keys a
// translation span may carry (no source text, context, refinements, prompts
// or outputs). Adding a key is a privacy decision; update this list with it.
var safeContextKeys = []string{
	"intent", "mode", "sourceLanguage", "targetLanguage", "uiLanguage",
	"hasContext", "refinementCount", "requestKind", "inputLengthBucket",
	"isPolish", "promptVersion", "requestedModel", "reasoningEffort",
	"serviceTier", "trigger", "analyticsSessionId", "clientRunId",
	"supersedesRunId", "inputRevision",
}

func attrMap(s sdktrace.ReadOnlySpan) map[string]string {
	out := map[string]string{}
	for _, kv := range s.Attributes() {
		out[string(kv.Key)] = kv.Value.Emit()
	}
	return out
}

func TestDisabledWithoutBothKeys(t *testing.T) {
	for _, vars := range []map[string]string{
		{},
		{"LANGFUSE_PUBLIC_KEY": "pk"},
		{"LANGFUSE_SECRET_KEY": "sk"},
		{"LANGFUSE_PUBLIC_KEY": "pk", "LANGFUSE_SECRET_KEY": "  "},
		{"LANGFUSE_PUBLIC_KEY": "\t", "LANGFUSE_SECRET_KEY": "sk"},
	} {
		if tr := Setup(env(vars)); tr != nil {
			t.Errorf("Setup(%v) enabled telemetry", slices.Sorted(maps.Keys(vars)))
		}
	}
	// The disabled tracer is a no-op.
	var tr *Tracer
	gen := tr.StartGeneration(context.Background(), NewRuntimeContext(canaryInput(), testCfg, "v", analytics()))
	if gen != nil {
		t.Fatal("disabled tracer started a generation")
	}
	gen.End(llm.Usage{InputTokens: 1}, llm.KindProvider)
}

func TestAttributeKeysExactlyAllowlist(t *testing.T) {
	tr, exp := memTracer(t, nil)
	tr.StartGeneration(context.Background(), NewRuntimeContext(canaryInput(), testCfg, "v9", analytics())).
		End(llm.Usage{InputTokens: 1200, OutputTokens: 42}, "")
	spans := exp.GetSpans().Snapshots()
	if len(spans) != 1 {
		t.Fatalf("spans = %d, want 1", len(spans))
	}
	s := spans[0]
	if s.Name() != "translation" {
		t.Errorf("name = %q", s.Name())
	}
	want := []string{
		"langfuse.observation.type", "langfuse.trace.name", "gen_ai.request.model",
		"gen_ai.usage.input_tokens", "gen_ai.usage.output_tokens",
	}
	for _, k := range safeContextKeys {
		want = append(want, "langfuse.observation.metadata."+k)
	}
	got := attrMap(s)
	if g, w := slices.Sorted(maps.Keys(got)), slices.Sorted(slices.Values(want)); !slices.Equal(g, w) {
		t.Fatalf("attribute keys\n got %v\nwant %v", g, w)
	}
	for k, v := range map[string]string{
		"langfuse.observation.type":                       "generation",
		"langfuse.trace.name":                             "translation",
		"gen_ai.request.model":                            "gpt-6.1-terra",
		"gen_ai.usage.input_tokens":                       "1200",
		"gen_ai.usage.output_tokens":                      "42",
		"langfuse.observation.metadata.intent":            "sentence",
		"langfuse.observation.metadata.mode":              "casual",
		"langfuse.observation.metadata.sourceLanguage":    "en",
		"langfuse.observation.metadata.targetLanguage":    "ko",
		"langfuse.observation.metadata.uiLanguage":        "en",
		"langfuse.observation.metadata.hasContext":        "true",
		"langfuse.observation.metadata.refinementCount":   "2",
		"langfuse.observation.metadata.requestKind":       "refinement",
		"langfuse.observation.metadata.inputLengthBucket": "25-100", // untrimmed "  source <canary>  "
		"langfuse.observation.metadata.isPolish":          "false",
		"langfuse.observation.metadata.promptVersion":     "v9",
		"langfuse.observation.metadata.requestedModel":    "gpt-6.1-terra",
		"langfuse.observation.metadata.reasoningEffort":   "none",
		"langfuse.observation.metadata.serviceTier":       "fast",
		"langfuse.observation.metadata.trigger":           "refinement",
		"langfuse.observation.metadata.inputRevision":     "3",
		"langfuse.observation.metadata.clientRunId":       "22222222-2222-4222-8222-222222222222",
	} {
		if got[k] != v {
			t.Errorf("%s = %q, want %q", k, got[k], v)
		}
	}
	if s.Status().Code != codes.Unset || len(s.Events()) != 0 {
		t.Errorf("success span status %v events %d", s.Status(), len(s.Events()))
	}

	// A failure records its kind only, and no usage the provider never reported.
	tr.StartGeneration(context.Background(), NewRuntimeContext(canaryInput(), testCfg, "v9", analytics())).
		End(llm.Usage{}, llm.KindRateLimit)
	failed := exp.GetSpans().Snapshots()[1]
	keys := slices.Sorted(maps.Keys(attrMap(failed)))
	wantFailed := slices.DeleteFunc(slices.Sorted(slices.Values(want)), func(k string) bool { return strings.HasPrefix(k, "gen_ai.usage.") })
	if !slices.Equal(keys, wantFailed) {
		t.Errorf("failed span keys\n got %v\nwant %v", keys, wantFailed)
	}
	if st := failed.Status(); st.Code != codes.Error || st.Description != "rate_limit" || len(failed.Events()) != 0 {
		t.Errorf("failed span status %v events %d", st, len(failed.Events()))
	}
}

func TestRuntimeContext(t *testing.T) {
	in := prompt.TranslateInput{Text: "hi", Source: "ko", Target: "ko", Mode: "friends", Intent: "word", UILang: "ko"}
	rc := NewRuntimeContext(in, testCfg, "v", Analytics{InputRevision: -1, Trigger: "debounce"})
	if rc.RequestKind != "initial" || rc.HasContext || !rc.IsPolish || rc.InputRevision != -1 || rc.SupersedesRunID != "" {
		t.Errorf("initial context %+v", rc)
	}
	in.Context = "c"
	if rc := NewRuntimeContext(in, testCfg, "v", Analytics{}); rc.RequestKind != "context" || !rc.HasContext {
		t.Errorf("context kind %+v", rc)
	}
	in.Refinements = []string{"make it shorter"}
	if rc := NewRuntimeContext(in, testCfg, "v", Analytics{}); rc.RequestKind != "refinement" {
		t.Errorf("refinement kind %+v", rc)
	}
	for n, want := range map[int]string{0: "0", 1: "1-24", 24: "1-24", 25: "25-100", 100: "25-100", 101: "101-500", 500: "101-500", 501: "501-2000", 2000: "501-2000", 2001: "2001+"} {
		if got := LengthBucket(n); got != want {
			t.Errorf("LengthBucket(%d) = %q, want %q", n, got, want)
		}
	}
	// TS data.text.length: UTF-16 units of the text as posted ("😀" counts
	// 2), surrounding whitespace included.
	in.Text = strings.Repeat("😀", 12)
	if rc := NewRuntimeContext(in, testCfg, "v", Analytics{}); rc.InputLengthBucket != "1-24" {
		t.Errorf("12 emoji bucket %q", rc.InputLengthBucket)
	}
	in.Text = " " + strings.Repeat("😀", 12)
	if rc := NewRuntimeContext(in, testCfg, "v", Analytics{}); rc.InputLengthBucket != "25-100" {
		t.Errorf("space + 12 emoji bucket %q", rc.InputLengthBucket)
	}
	in.Text = strings.Repeat("😀", 13)
	if rc := NewRuntimeContext(in, testCfg, "v", Analytics{}); rc.InputLengthBucket != "25-100" {
		t.Errorf("13 emoji bucket %q", rc.InputLengthBucket)
	}
}

func TestNoContentInSpans(t *testing.T) {
	tr, exp := memTracer(t, map[string]string{"LANGFUSE_TRACING_ENVIRONMENT": "test", "LANGFUSE_RELEASE": "r1"})
	tr.StartGeneration(context.Background(), NewRuntimeContext(canaryInput(), testCfg, "v", analytics())).
		End(llm.Usage{InputTokens: 1, OutputTokens: 1}, llm.KindStructuredOutput)
	for _, s := range exp.GetSpans().Snapshots() {
		var all []string
		for _, kv := range s.Attributes() {
			all = append(all, string(kv.Key), kv.Value.Emit())
		}
		for _, kv := range s.Resource().Attributes() {
			all = append(all, string(kv.Key), kv.Value.Emit())
		}
		for _, ev := range s.Events() {
			all = append(all, ev.Name)
		}
		all = append(all, s.Name(), s.Status().Description, s.InstrumentationScope().Name)
		for _, v := range all {
			if strings.Contains(v, canary) {
				t.Errorf("span carries content: %q", v)
			}
		}
	}
}

// receiver is an OTLP/HTTP endpoint that records each request.
type receiver struct {
	mu       sync.Mutex
	status   int
	headers  []http.Header
	paths    []string
	bodies   [][]byte
	requests []*collectorpb.ExportTraceServiceRequest
}

func newReceiver(t *testing.T, status int) (*receiver, *httptest.Server) {
	t.Helper()
	rcv := &receiver{status: status}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		req := &collectorpb.ExportTraceServiceRequest{}
		if err := proto.Unmarshal(body, req); err != nil {
			t.Errorf("OTLP body is not protobuf: %v", err)
		}
		rcv.mu.Lock()
		rcv.headers = append(rcv.headers, r.Header.Clone())
		rcv.paths = append(rcv.paths, r.URL.Path)
		rcv.bodies = append(rcv.bodies, body)
		rcv.requests = append(rcv.requests, req)
		rcv.mu.Unlock()
		if rcv.status != http.StatusOK {
			http.Error(w, "receiver failure "+canary, rcv.status)
			return
		}
		w.Header().Set("Content-Type", "application/x-protobuf")
	}))
	t.Cleanup(srv.Close)
	return rcv, srv
}

func captureLog(t *testing.T) *bytes.Buffer {
	t.Helper()
	var buf bytes.Buffer
	prev, flags := log.Writer(), log.Flags()
	log.SetOutput(&buf)
	log.SetFlags(0)
	t.Cleanup(func() { log.SetOutput(prev); log.SetFlags(flags) })
	return &buf
}

func TestOTLPHeaders(t *testing.T) {
	rcv, srv := newReceiver(t, http.StatusOK)
	tr := Setup(env(map[string]string{
		"LANGFUSE_PUBLIC_KEY": "pk-lf-test", "LANGFUSE_SECRET_KEY": "sk-lf-test",
		"LANGFUSE_BASE_URL": srv.URL + "/", "LANGFUSE_TRACING_ENVIRONMENT": "preview", "LANGFUSE_RELEASE": "abc123",
	}))
	if tr == nil {
		t.Fatal("telemetry disabled with both keys set")
	}
	tr.StartGeneration(context.Background(), NewRuntimeContext(canaryInput(), testCfg, "v", analytics())).
		End(llm.Usage{InputTokens: 5, OutputTokens: 6}, "")
	// WithSyncer: the span was exported before End returned.
	rcv.mu.Lock()
	defer rcv.mu.Unlock()
	if len(rcv.headers) != 1 {
		t.Fatalf("exports = %d, want 1 (synchronous)", len(rcv.headers))
	}
	h := rcv.headers[0]
	if got, want := h.Get("Authorization"), "Basic "+base64.StdEncoding.EncodeToString([]byte("pk-lf-test:sk-lf-test")); got != want {
		t.Errorf("Authorization = %q, want %q", got, want)
	}
	if got := h.Get("X-Langfuse-Ingestion-Version"); got != "4" {
		t.Errorf("x-langfuse-ingestion-version = %q", got)
	}
	if got := h.Get("Content-Type"); got != "application/x-protobuf" {
		t.Errorf("Content-Type = %q", got)
	}
	if rcv.paths[0] != "/api/public/otel/v1/traces" {
		t.Errorf("path = %q", rcv.paths[0])
	}
	rs := rcv.requests[0].GetResourceSpans()
	if len(rs) != 1 {
		t.Fatalf("resource spans = %d", len(rs))
	}
	res := map[string]string{}
	for _, kv := range rs[0].GetResource().GetAttributes() {
		res[kv.GetKey()] = kv.GetValue().GetStringValue()
	}
	if res["langfuse.environment"] != "preview" || res["langfuse.release"] != "abc123" {
		t.Errorf("resource attributes %v", res)
	}
	spans := rs[0].GetScopeSpans()[0].GetSpans()
	if len(spans) != 1 || spans[0].GetName() != "translation" {
		t.Fatalf("spans %v", spans)
	}
	if bytes.Contains(rcv.bodies[0], []byte(canary)) {
		t.Error("export body carries content")
	}
}

func TestSlowReceiverIsCutAtTwoSeconds(t *testing.T) {
	logs := captureLog(t)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-time.After(5 * time.Second):
		case <-r.Context().Done():
		}
	}))
	t.Cleanup(srv.Close)
	tr := Setup(env(map[string]string{"LANGFUSE_PUBLIC_KEY": "pk", "LANGFUSE_SECRET_KEY": "sk", "LANGFUSE_BASE_URL": srv.URL}))
	start := time.Now()
	tr.StartGeneration(context.Background(), NewRuntimeContext(canaryInput(), testCfg, "v", analytics())).
		End(llm.Usage{}, "")
	if d := time.Since(start); d < 1500*time.Millisecond || d > 2500*time.Millisecond {
		t.Fatalf("End took %v, want the 2 s export timeout", d)
	}
	if c := strings.Count(logs.String(), "[langfuse]"); c != 1 {
		t.Fatalf("warnings = %d, want 1", c)
	}
}

func TestExporterFailureIsNonFatal(t *testing.T) {
	logs := captureLog(t)
	rcv, srv := newReceiver(t, http.StatusInternalServerError)
	tr := Setup(env(map[string]string{"LANGFUSE_PUBLIC_KEY": "pk", "LANGFUSE_SECRET_KEY": "sk", "LANGFUSE_BASE_URL": srv.URL}))
	for range 3 {
		tr.StartGeneration(context.Background(), NewRuntimeContext(canaryInput(), testCfg, "v", analytics())).
			End(llm.Usage{}, llm.KindProvider)
	}
	rcv.mu.Lock()
	n := len(rcv.requests)
	rcv.mu.Unlock()
	if n != 3 {
		t.Fatalf("exports = %d, want 3 (no retries, one per span)", n)
	}
	out := logs.String()
	if c := strings.Count(out, "[langfuse]"); c != 1 {
		t.Fatalf("warnings = %d, want 1:\n%s", c, out)
	}
	if strings.Contains(out, canary) || strings.Contains(out, "500") {
		t.Errorf("warning carries the export error: %q", out)
	}
}
