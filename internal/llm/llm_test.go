package llm_test

import (
	"context"
	"encoding/json/jsontext"
	"encoding/json/v2"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"neotranslate/internal/config"
	"neotranslate/internal/contract"
	"neotranslate/internal/fakeopenai"
	"neotranslate/internal/llm"
	"neotranslate/internal/prompt"
)

const fixturesDir = "../../e2e/fixtures/results"

type stats struct {
	Requests   int      `json:"requests"`
	Aborted    int      `json:"aborted"`
	Active     int      `json:"active"`
	LastBodies []string `json:"lastBodies"`
}

func getStats(t *testing.T, base string) stats {
	t.Helper()
	res, err := http.Get(base + "/_stats")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var s stats
	b, _ := io.ReadAll(res.Body)
	if err := json.Unmarshal(b, &s); err != nil {
		t.Fatal(err)
	}
	return s
}

func waitIdle(t *testing.T, base string) stats {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for {
		s := getStats(t, base)
		if s.Active == 0 {
			return s
		}
		if time.Now().After(deadline) {
			t.Fatal("fake still has active requests")
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func setup(t *testing.T) (*llm.Client, string) {
	t.Helper()
	srv := httptest.NewServer(fakeopenai.Handler(fixturesDir))
	t.Cleanup(srv.Close)
	env := map[string]string{"OPENAI_API_KEY": "sk-test", "OPENAI_BASE_URL": srv.URL + "/v1"}
	return llm.New(func(k string) string { return env[k] }), srv.URL
}

func body(t *testing.T, marker string) []byte {
	t.Helper()
	c, err := contract.Load()
	if err != nil {
		t.Fatal(err)
	}
	cfg, err := config.LoadTranslate(func(string) string { return "" })
	if err != nil {
		t.Fatal(err)
	}
	b, err := prompt.BuildRequest(c, prompt.TranslateInput{
		Text: "Hello there " + marker, Source: "en", Target: "ko", Mode: "casual",
		Intent: "sentence", UILang: "en",
	}, cfg)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func jsonEqual(t *testing.T, a, b []byte) bool {
	t.Helper()
	var x, y any
	if err := json.Unmarshal(a, &x); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(b, &y); err != nil {
		t.Fatal(err)
	}
	return reflect.DeepEqual(x, y)
}

func TestStreamTextDeltasEqualFixtureAndWireBodyEqualsInput(t *testing.T) {
	c, base := setup(t)
	in := body(t, "[fx:stream]")
	var sb strings.Builder
	n := 0
	for d, err := range c.StreamText(context.Background(), in, nil) {
		if err != nil {
			t.Fatal(err)
		}
		sb.WriteString(d)
		n++
	}
	if n < 2 {
		t.Fatalf("want several deltas, got %d", n)
	}
	raw, err := os.ReadFile(filepath.Join(fixturesDir, "stream.json"))
	if err != nil {
		t.Fatal(err)
	}
	var fx struct {
		Result jsontext.Value `json:"result"`
	}
	if err := json.Unmarshal(raw, &fx); err != nil {
		t.Fatal(err)
	}
	if !jsonEqual(t, []byte(sb.String()), fx.Result) {
		t.Fatalf("deltas do not equal fixture result:\n%s", sb.String())
	}
	s := waitIdle(t, base)
	if s.Requests != 1 || len(s.LastBodies) != 1 {
		t.Fatalf("stats = %+v", s)
	}
	if !jsonEqual(t, []byte(s.LastBodies[0]), in) {
		t.Fatalf("wire body differs from input:\nwire: %s\nin:   %s", s.LastBodies[0], in)
	}
	if s.LastBodies[0] != string(in) {
		t.Fatalf("wire body is JSON-equal but not byte-identical")
	}
}

func TestClassifyFixtures(t *testing.T) {
	c, base := setup(t)
	cases := map[string]llm.Kind{
		"[fx:error-auth]":     llm.KindAuthentication,
		"[fx:error-budget]":   llm.KindBudget,
		"[fx:error-rate]":     llm.KindRateLimit,
		"[fx:error-model]":    llm.KindModelConfiguration,
		"[fx:error-provider]": llm.KindProvider,
	}
	for marker, want := range cases {
		var got error
		for _, err := range c.StreamText(context.Background(), body(t, marker), nil) {
			got = err
			break
		}
		if got == nil {
			t.Fatalf("%s: no error", marker)
		}
		if k := llm.Classify(got); k != want {
			t.Errorf("%s: kind %s, want %s", marker, k, want)
		}
	}
	waitIdle(t, base)
}

func TestNoRetryOn429(t *testing.T) {
	c, base := setup(t)
	for range c.StreamText(context.Background(), body(t, "[fx:error-rate]"), nil) {
	}
	if s := waitIdle(t, base); s.Requests != 1 {
		t.Fatalf("requests = %d, want 1 (no retries)", s.Requests)
	}
}

func TestMissingAPIKey(t *testing.T) {
	srv := httptest.NewServer(fakeopenai.Handler(fixturesDir))
	defer srv.Close()
	c := llm.New(func(k string) string {
		if k == "OPENAI_BASE_URL" {
			return srv.URL + "/v1"
		}
		return ""
	})
	var got error
	for _, err := range c.StreamText(context.Background(), body(t, "[fx:stream]"), nil) {
		got = err
	}
	if !errors.Is(got, llm.ErrMissingAPIKey) || llm.Classify(got) != llm.KindConfiguration {
		t.Fatalf("got %v (%s)", got, llm.Classify(got))
	}
	if s := getStats(t, srv.URL); s.Requests != 0 {
		t.Fatalf("a request was sent without a key: %+v", s)
	}
}

func TestAPIKeyReadPerRequest(t *testing.T) {
	srv := httptest.NewServer(fakeopenai.Handler(fixturesDir))
	defer srv.Close()
	key := ""
	c := llm.New(func(k string) string {
		switch k {
		case "OPENAI_BASE_URL":
			return srv.URL + "/v1"
		case "OPENAI_API_KEY":
			return key
		}
		return ""
	})
	for _, err := range c.StreamText(context.Background(), body(t, "[fx:stream]"), nil) {
		if !errors.Is(err, llm.ErrMissingAPIKey) {
			t.Fatalf("want missing key, got %v", err)
		}
	}
	key = "sk-late"
	for _, err := range c.StreamText(context.Background(), body(t, "[fx:stream]"), nil) {
		if err != nil {
			t.Fatal(err)
		}
	}
}

func TestCancelAfterFirstDeltaAbortsUpstream(t *testing.T) {
	c, base := setup(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var last error
	deltas := 0
	for d, err := range c.StreamText(ctx, body(t, "[fx:slow]"), nil) {
		if err != nil {
			last = err
			break
		}
		if d != "" {
			deltas++
			cancel()
		}
	}
	if deltas != 1 {
		t.Fatalf("deltas = %d, want 1", deltas)
	}
	if !errors.Is(last, context.Canceled) {
		t.Fatalf("want context.Canceled, got %v", last)
	}
	if s := waitIdle(t, base); s.Aborted != 1 {
		t.Fatalf("aborted = %d, want 1", s.Aborted)
	}
}

func TestClassifyNonAPIErrorIsProvider(t *testing.T) {
	if k := llm.Classify(errors.New("boom")); k != llm.KindProvider {
		t.Fatal(k)
	}
}

func faultClient(t *testing.T, name string, fault string) *llm.Client {
	t.Helper()
	dir := t.TempDir()
	fx := `{"match":"[fx:` + name + `]","delayMs":1,"chunk":10,"result":{"main":"hello there, this is long enough"},"fault":` + fault + `}`
	if err := os.WriteFile(filepath.Join(dir, name+".json"), []byte(fx), 0o644); err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(fakeopenai.Handler(dir))
	t.Cleanup(srv.Close)
	env := map[string]string{"OPENAI_API_KEY": "sk-test", "OPENAI_BASE_URL": srv.URL + "/v1"}
	return llm.New(func(k string) string { return env[k] })
}

func TestStreamFaults(t *testing.T) {
	cases := []struct {
		name, fault string
		want        llm.Kind
		wantErr     error
	}{
		{"err-quota", `{"kind":"error","after":2,"code":"insufficient_quota"}`, llm.KindBudget, nil},
		{"err-rate", `{"kind":"error","after":2,"code":"rate_limit_exceeded"}`, llm.KindRateLimit, nil},
		{"err-other", `{"kind":"error","after":2,"code":"server_error"}`, llm.KindProvider, nil},
		{"nest-quota", `{"kind":"error-nested","after":2,"code":"insufficient_quota"}`, llm.KindBudget, nil},
		{"nest-rate", `{"kind":"error-nested","after":2,"code":"rate_limit_exceeded"}`, llm.KindRateLimit, nil},
		{"failed-rate", `{"kind":"failed","after":2,"code":"rate_limit_exceeded"}`, llm.KindRateLimit, nil},
		{"failed-other", `{"kind":"failed","after":2,"code":"server_error"}`, llm.KindProvider, nil},
		{"incomplete", `{"kind":"incomplete","after":2,"reason":"max_output_tokens"}`, llm.KindStructuredOutput, llm.ErrIncomplete},
		{"truncate", `{"kind":"truncate","after":2}`, llm.KindProvider, llm.ErrTruncated},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c := faultClient(t, tc.name, tc.fault)
			deltas := 0
			var got error
			for _, err := range c.StreamText(context.Background(), body(t, "[fx:"+tc.name+"]"), nil) {
				if err != nil {
					got = err
					break
				}
				deltas++
			}
			if got == nil {
				t.Fatal("stream ended without error")
			}
			if deltas != 2 {
				t.Errorf("deltas = %d, want 2", deltas)
			}
			if k := llm.Classify(got); k != tc.want {
				t.Errorf("kind %s, want %s (%v)", k, tc.want, got)
			}
			if tc.wantErr != nil && !errors.Is(got, tc.wantErr) {
				t.Errorf("err %v, want %v", got, tc.wantErr)
			}
			if strings.Contains(got.Error(), fakeopenai.FaultMessage) {
				t.Errorf("error leaks provider text: %v", got)
			}
		})
	}
}

func TestStreamTextReportsUsage(t *testing.T) {
	c, _ := setup(t)
	var usage llm.Usage
	n := 0
	for _, err := range c.StreamText(context.Background(), body(t, "[fx:stream]"), &usage) {
		if err != nil {
			t.Fatal(err)
		}
		n++
	}
	// The fake reports 1200 input tokens and 3 output tokens per chunk.
	if usage.InputTokens != 1200 || usage.OutputTokens != int64(n*3) {
		t.Fatalf("usage = %+v, want {1200 %d}", usage, n*3)
	}
	var none llm.Usage
	for range c.StreamText(context.Background(), body(t, "[fx:error-rate]"), &none) {
	}
	if none != (llm.Usage{}) {
		t.Fatalf("usage after an error event = %+v, want zero", none)
	}
}

func TestHTTPErrorsAreContentFree(t *testing.T) {
	c, _ := setup(t)
	for _, marker := range []string{"[fx:error-auth]", "[fx:error-budget]", "[fx:error-rate]", "[fx:error-model]", "[fx:error-provider]"} {
		for _, err := range c.StreamText(context.Background(), body(t, marker), nil) {
			for _, leak := range []string{"Incorrect API key", "exceeded your current quota", "Rate limit reached", "does not exist", "server had an error"} {
				if strings.Contains(err.Error(), leak) {
					t.Errorf("%s leaks %q: %v", marker, leak, err)
				}
			}
		}
	}
}
