package translate

import (
	"bytes"
	"context"
	"io"
	"log"
	"maps"
	"net/http"
	"net/http/httptest"
	"regexp"
	"slices"
	"strings"
	"sync"
	"testing"

	collectorpb "go.opentelemetry.io/proto/otlp/collector/trace/v1"
	tracepb "go.opentelemetry.io/proto/otlp/trace/v1"
	"google.golang.org/protobuf/proto"
)

const canary = "nt-canary-9c4b"

// otlpReceiver is a fake Langfuse OTLP/HTTP endpoint.
type otlpReceiver struct {
	mu     sync.Mutex
	status int
	bodies [][]byte
	spans  []*tracepb.Span
	onPost func() // runs before the response (ordering tests)
}

func newOTLPReceiver(t *testing.T, status int) (*otlpReceiver, *httptest.Server) {
	t.Helper()
	rcv := &otlpReceiver{status: status}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		req := &collectorpb.ExportTraceServiceRequest{}
		if err := proto.Unmarshal(body, req); err != nil {
			t.Errorf("OTLP body is not protobuf: %v", err)
		}
		rcv.mu.Lock()
		rcv.bodies = append(rcv.bodies, body)
		for _, rs := range req.GetResourceSpans() {
			for _, ss := range rs.GetScopeSpans() {
				rcv.spans = append(rcv.spans, ss.GetSpans()...)
			}
		}
		onPost := rcv.onPost
		rcv.mu.Unlock()
		if onPost != nil {
			onPost()
		}
		if rcv.status != http.StatusOK {
			http.Error(w, "receiver failure "+canary, rcv.status)
		}
	}))
	t.Cleanup(srv.Close)
	return rcv, srv
}

func (r *otlpReceiver) snapshot() ([][]byte, []*tracepb.Span) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return slices.Clone(r.bodies), slices.Clone(r.spans)
}

func tracedEnv(t *testing.T, status int) (*env, *otlpReceiver) {
	t.Helper()
	rcv, srv := newOTLPReceiver(t, status)
	e := newEnv(t, fixturesDir, map[string]string{
		"LANGFUSE_PUBLIC_KEY": "pk-lf-test", "LANGFUSE_SECRET_KEY": "sk-lf-test", "LANGFUSE_BASE_URL": srv.URL,
	})
	return e, rcv
}

func spanAttrs(s *tracepb.Span) map[string]string {
	out := map[string]string{}
	for _, kv := range s.GetAttributes() {
		// Strings as is; ints and bools in their prototext form ("int_value:7").
		if v := kv.GetValue(); v.GetStringValue() != "" {
			out[kv.GetKey()] = v.GetStringValue()
		} else {
			out[kv.GetKey()] = v.String()
		}
	}
	return out
}

// stringLeaves collects every string in a decoded fixture result.
func stringLeaves(v any, out *[]string) {
	switch x := v.(type) {
	case string:
		*out = append(*out, x)
	case []any:
		for _, e := range x {
			stringLeaves(e, out)
		}
	case map[string]any:
		for _, e := range x {
			stringLeaves(e, out)
		}
	}
}

func TestNoContentInSpans(t *testing.T) {
	e, rcv := tracedEnv(t, http.StatusOK)
	evs := parseSSE(t, e.run(t, form("How are you doing today? "+canary,
		"context", "Replying to "+canary,
		"refinements", "custom "+canary,
		"previousMain", "previous "+canary,
		"analyticsSessionId", "11111111-1111-4111-8111-111111111111",
		"supersedesRunId", "33333333-3333-4333-8333-333333333333",
		"inputRevision", "7", "trigger", "refinement")))
	if index(evs, evDone) < 0 {
		t.Fatalf("run did not complete: %v", names(evs))
	}
	bodies, spans := rcv.snapshot()
	if len(spans) != 1 {
		t.Fatalf("spans = %d, want 1", len(spans))
	}
	// Nothing the user typed or the model wrote reaches the export: not the
	// canary, and no string of the fixture result (main, rationale, …).
	var leaves []string
	stringLeaves(loadFixture(t, "default.json").Result, &leaves)
	for _, body := range bodies {
		if bytes.Contains(body, []byte(canary)) {
			t.Error("export carries user content")
		}
		for _, s := range leaves {
			if len(s) >= 12 && bytes.Contains(body, []byte(s)) {
				t.Errorf("export carries model output %q", s)
			}
		}
	}
	s := spans[0]
	if len(s.GetEvents()) != 0 || s.GetStatus().GetMessage() != "" {
		t.Errorf("success span has events %v / status %v", s.GetEvents(), s.GetStatus())
	}
	attrs := spanAttrs(s)
	want := []string{
		"langfuse.observation.type", "langfuse.trace.name", "gen_ai.request.model",
		"gen_ai.usage.input_tokens", "gen_ai.usage.output_tokens",
	}
	for _, k := range []string{
		"intent", "mode", "sourceLanguage", "targetLanguage", "uiLanguage", "hasContext",
		"refinementCount", "requestKind", "inputLengthBucket", "isPolish", "promptVersion",
		"requestedModel", "reasoningEffort", "serviceTier", "trigger", "analyticsSessionId",
		"clientRunId", "supersedesRunId", "inputRevision",
	} {
		want = append(want, "langfuse.observation.metadata."+k)
	}
	if g, w := slices.Sorted(maps.Keys(attrs)), slices.Sorted(slices.Values(want)); !slices.Equal(g, w) {
		t.Fatalf("attribute keys\n got %v\nwant %v", g, w)
	}
	for k, v := range map[string]string{
		"langfuse.observation.metadata.requestKind":        "refinement",
		"langfuse.observation.metadata.trigger":            "refinement",
		"langfuse.observation.metadata.clientRunId":        "run-1",
		"langfuse.observation.metadata.analyticsSessionId": "11111111-1111-4111-8111-111111111111",
		"langfuse.observation.metadata.supersedesRunId":    "33333333-3333-4333-8333-333333333333",
		"langfuse.observation.metadata.inputLengthBucket":  "25-100",
		"langfuse.observation.metadata.promptVersion":      e.c.CacheVersion,
	} {
		if attrs[k] != v {
			t.Errorf("%s = %q, want %q", k, attrs[k], v)
		}
	}
	if !strings.Contains(attrs["langfuse.observation.metadata.inputRevision"], "7") ||
		!strings.Contains(attrs["gen_ai.usage.input_tokens"], "1200") {
		t.Errorf("int attributes %q / %q", attrs["langfuse.observation.metadata.inputRevision"], attrs["gen_ai.usage.input_tokens"])
	}
}

func TestFailedRunRecordsKindOnly(t *testing.T) {
	e, rcv := tracedEnv(t, http.StatusOK)
	evs := parseSSE(t, e.run(t, form("Hello [fx:error-rate] "+canary)))
	if index(evs, evError) < 0 {
		t.Fatalf("want nt-error: %v", names(evs))
	}
	bodies, spans := rcv.snapshot()
	if len(spans) != 1 {
		t.Fatalf("spans = %d, want 1", len(spans))
	}
	if st := spans[0].GetStatus(); st.GetCode() != tracepb.Status_STATUS_CODE_ERROR || st.GetMessage() != "rate_limit" {
		t.Errorf("status %v, want error rate_limit", st)
	}
	if len(spans[0].GetEvents()) != 0 {
		t.Errorf("error span has events %v", spans[0].GetEvents())
	}
	if bytes.Contains(bodies[0], []byte(canary)) || bytes.Contains(bodies[0], []byte("Rate limit reached")) {
		t.Error("export carries content or provider text")
	}
}

func TestCacheHitCreatesNoSpan(t *testing.T) {
	e, rcv := tracedEnv(t, http.StatusOK)
	e.run(t, form("How are you doing today?", "trigger", "paste"))
	// Analytics fields are not part of the cache key.
	e.run(t, form("How are you doing today?", "run", "run-2", "trigger", "force", "inputRevision", "9"))
	if st := e.stats(t); st.Requests != 1 {
		t.Fatalf("upstream requests = %d, want 1", st.Requests)
	}
	if _, spans := rcv.snapshot(); len(spans) != 1 {
		t.Fatalf("spans = %d, want 1 (cache hits are not traced)", len(spans))
	}
}

func TestUntracedWithoutKeys(t *testing.T) {
	rcv, srv := newOTLPReceiver(t, http.StatusOK)
	e := newEnv(t, fixturesDir, map[string]string{"LANGFUSE_PUBLIC_KEY": "pk-lf-test", "LANGFUSE_BASE_URL": srv.URL})
	e.run(t, form("How are you doing today?"))
	if bodies, _ := rcv.snapshot(); len(bodies) != 0 {
		t.Fatalf("exports = %d without a secret key", len(bodies))
	}
}

// orderWriter is a ResponseWriter that logs each flush with the last event
// written before it.
type orderWriter struct {
	header http.Header
	last   string
	log    func(string)
}

var eventLine = regexp.MustCompile(`(?m)^event: (\S+)`)

func (w *orderWriter) Header() http.Header { return w.header }
func (w *orderWriter) WriteHeader(int)     {}
func (w *orderWriter) Write(b []byte) (int, error) {
	if m := eventLine.FindAllSubmatch(b, -1); m != nil {
		w.last = string(m[len(m)-1][1])
	}
	return len(b), nil
}
func (w *orderWriter) Flush() { w.log("flush:" + w.last) }

func TestSpanEndsAfterDoneFlushed(t *testing.T) {
	e, rcv := tracedEnv(t, http.StatusOK)
	var mu sync.Mutex
	var order []string
	add := func(s string) {
		mu.Lock()
		order = append(order, s)
		mu.Unlock()
	}
	rcv.onPost = func() { add("export") }
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/translate",
		strings.NewReader(form("How are you doing today?").Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	e.s.HandleTranslate(&orderWriter{header: http.Header{}, log: add}, req)

	done := slices.Index(order, "flush:"+evDone)
	export := slices.Index(order, "export")
	if done < 0 || export < 0 || export < done {
		t.Fatalf("want export after the flushed nt-done, got %v", order)
	}
}

func TestExporterFailureIsNonFatal(t *testing.T) {
	var logs bytes.Buffer
	prev, flags := log.Writer(), log.Flags()
	log.SetOutput(&logs)
	t.Cleanup(func() { log.SetOutput(prev); log.SetFlags(flags) })

	e, rcv := tracedEnv(t, http.StatusInternalServerError)
	for _, text := range []string{"How are you doing today?", "Good morning " + canary} {
		evs := parseSSE(t, e.run(t, form(text)))
		if index(evs, evDone) < 0 {
			t.Fatalf("translation failed with a failing receiver: %v", names(evs))
		}
	}
	if bodies, _ := rcv.snapshot(); len(bodies) != 2 {
		t.Fatalf("exports = %d, want 2", len(bodies))
	}
	out := logs.String()
	if c := strings.Count(out, "[langfuse]"); c != 1 {
		t.Fatalf("warnings = %d, want exactly 1:\n%s", c, out)
	}
	if strings.Contains(out, canary) {
		t.Errorf("log carries content or the receiver body: %q", out)
	}
}

func TestAnalyticsFieldsValidated(t *testing.T) {
	e := newEnv(t, fixturesDir, nil)
	for _, extra := range [][]string{
		{"trigger", "typing"},
		{"analyticsSessionId", "not-a-uuid"},
		{"supersedesRunId", "123"},
		{"inputRevision", "-1"},
		{"inputRevision", "1.5"},
	} {
		resp := e.post(t, context.Background(), form("Hello", extra...))
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if resp.StatusCode != http.StatusBadRequest {
			t.Errorf("%v: status %d, want 400", extra, resp.StatusCode)
		}
		if !strings.Contains(string(body), extra[0]) || strings.Contains(string(body), extra[1]) {
			t.Errorf("%v: body %q must name the field only", extra, body)
		}
	}
	if st := e.stats(t); st.Requests != 0 {
		t.Fatalf("invalid analytics reached upstream: %d", st.Requests)
	}
}
