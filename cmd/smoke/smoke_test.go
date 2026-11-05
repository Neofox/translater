package main

import (
	"bytes"
	"encoding/json/v2"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"

	"neotranslate/internal/config"
	"neotranslate/internal/contract"
	"neotranslate/internal/fakeopenai"
	"neotranslate/internal/llm"
	"neotranslate/internal/speech"
	"neotranslate/internal/translate"
)

const secret = "BYPASS-SECRET-CANARY"

// stack is the Go app's /translate and /speech (wired as main.go's newMux
// does, which cmd/smoke cannot import) in front of the fake OpenAI server.
// It records the bypass header of every request the app received.
type stack struct {
	app, fake *httptest.Server
	mu        sync.Mutex
	bypass    []string
}

func newStack(t *testing.T) *stack {
	t.Helper()
	fake := httptest.NewServer(fakeopenai.Handler("../../e2e/fixtures/results"))
	t.Cleanup(fake.Close)
	env := map[string]string{"OPENAI_API_KEY": "test", "OPENAI_BASE_URL": fake.URL + "/v1"}
	getenv := func(k string) string { return env[k] }
	c, err := contract.Load()
	if err != nil {
		t.Fatal(err)
	}
	cfg, err := config.LoadTranslate(getenv)
	if err != nil {
		t.Fatal(err)
	}
	client := llm.New(getenv)
	tr := translate.NewServer(c, cfg, client)
	mux := http.NewServeMux()
	mux.HandleFunc("POST /translate", tr.HandleTranslate)
	mux.Handle("POST /speech", speech.NewHandler(client, getenv, speech.Timeout))
	s := &stack{fake: fake}
	s.app = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s.mu.Lock()
		s.bypass = append(s.bypass, r.Header.Get("x-vercel-protection-bypass"))
		s.mu.Unlock()
		mux.ServeHTTP(w, r)
	}))
	t.Cleanup(s.app.Close)
	return s
}

func (s *stack) stats(t *testing.T) fakeopenai.Stats {
	t.Helper()
	res, err := http.Get(s.fake.URL + "/_stats")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var st fakeopenai.Stats
	if err := json.UnmarshalRead(res.Body, &st); err != nil {
		t.Fatal(err)
	}
	return st
}

// smoke runs the command in-process; env supplies the bypass variable.
func smoke(t *testing.T, env map[string]string, args ...string) (int, string, string) {
	t.Helper()
	var stdout, stderr bytes.Buffer
	code := run(args, func(k string) string { return env[k] }, &stdout, &stderr, http.DefaultTransport)
	return code, stdout.String(), stderr.String()
}

// assertContentFree fails when any of secrets appears in the output.
func assertContentFree(t *testing.T, out string, secrets ...string) {
	t.Helper()
	for _, s := range secrets {
		if strings.Contains(out, s) {
			t.Errorf("output leaks %q:\n%s", s, out)
		}
	}
}

func TestTranslatePrintsTimingsOnly(t *testing.T) {
	s := newStack(t)
	text := "Smoke canary sentence [fx:plain]"
	code, out, errOut := smoke(t, map[string]string{"VERCEL_AUTOMATION_BYPASS_SECRET": secret},
		"-url", s.app.URL+"/", "-translate", "-text", text)
	if code != 0 {
		t.Fatalf("exit %d\nstdout:\n%s\nstderr:\n%s", code, out, errOut)
	}
	for _, want := range []string{"billed requests: 1 (translation)", "headers:", "nt-main-delta:", "nt-main-ready:", "nt-done:", "main deltas:", "delta spacing:", "smoke: OK"} {
		if !strings.Contains(out, want) {
			t.Errorf("stdout lacks %q:\n%s", want, out)
		}
	}
	// The fixture's main and learning text, the input and the secret.
	assertContentFree(t, out+errOut, "canary", "오늘", "어떻게", "today", secret)
	if st := s.stats(t); st.Requests != 1 || st.SpeechRequests != 0 {
		t.Errorf("upstream saw %d translations and %d speech requests, want 1 and 0", st.Requests, st.SpeechRequests)
	}
	if len(s.bypass) != 1 || s.bypass[0] != secret {
		t.Errorf("bypass headers %q, want one %q (from the environment)", s.bypass, secret)
	}
}

// A response that arrives at once (Vercel buffering, or an LRU hit) is a
// failure: the default fixture streams with no delay.
func TestTranslateBurstFails(t *testing.T) {
	s := newStack(t)
	code, out, errOut := smoke(t, nil, "-url", s.app.URL, "-translate", "-text", "Burst canary sentence.")
	if code != 1 || !strings.Contains(errOut, "buffered") || !strings.Contains(errOut, "LRU") {
		t.Fatalf("exit %d, stderr %q; want 1 naming buffering and the LRU", code, errOut)
	}
	assertContentFree(t, out+errOut, "canary", "오늘")
	if s.bypass[0] != "" {
		t.Errorf("sent a bypass header %q without a secret", s.bypass[0])
	}
}

func TestTranslateErrorReportsKindOnly(t *testing.T) {
	s := newStack(t)
	code, out, errOut := smoke(t, nil, "-url", s.app.URL, "-translate", "-text", "Error canary [fx:error-provider]")
	if code != 1 || !strings.Contains(errOut, `nt-error (kind "provider")`) {
		t.Fatalf("exit %d, stderr %q; want 1 with the provider kind", code, errOut)
	}
	assertContentFree(t, out+errOut, "canary", "Translation failed", "server had an error")
}

func TestSpeechPrintsAudioFacts(t *testing.T) {
	s := newStack(t)
	code, out, errOut := smoke(t, nil, "-url", s.app.URL, "-speech", "-bypass", secret, "-text", "Speech canary")
	if code != 0 {
		t.Fatalf("exit %d\nstdout:\n%s\nstderr:\n%s", code, out, errOut)
	}
	n := len(fakeopenai.SpeechTone())
	for _, want := range []string{
		"billed requests: 1 (speech)", "headers:", "first byte:", "done:",
		"bytes:          " + strconv.Itoa(n), "sample rate:    24000 Hz", "Content-Length: present (" + strconv.Itoa(n) + ")",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("stdout lacks %q:\n%s", want, out)
		}
	}
	assertContentFree(t, out+errOut, "canary", secret)
	if st := s.stats(t); st.SpeechRequests != 1 || st.Requests != 0 {
		t.Errorf("upstream saw %d speech and %d translation requests, want 1 and 0", st.SpeechRequests, st.Requests)
	}
	if len(s.bypass) != 1 || s.bypass[0] != secret {
		t.Errorf("bypass headers %q, want one %q (from -bypass)", s.bypass, secret)
	}
}

func TestSpeechErrorReportsStatusOnly(t *testing.T) {
	s := newStack(t)
	code, out, errOut := smoke(t, nil, "-url", s.app.URL, "-speech", "-text", "Speech [fx:speech-error]")
	if code != 1 || !strings.Contains(errOut, "HTTP 502") {
		t.Fatalf("exit %d, stderr %q; want 1 with HTTP 502", code, errOut)
	}
	assertContentFree(t, out+errOut, fakeopenai.FaultMessage, "Pronunciation failed")
}

func TestHTTPFailuresAreContentFree(t *testing.T) {
	cases := []struct {
		name    string
		handler http.HandlerFunc
		want    string
	}{
		{"protected", func(w http.ResponseWriter, _ *http.Request) {
			http.Error(w, "BODY-CANARY", http.StatusUnauthorized)
		}, "HTTP 401 (Deployment Protection?"},
		{"redirect", func(w http.ResponseWriter, r *http.Request) {
			http.Redirect(w, r, "/login?BODY-CANARY", http.StatusFound)
		}, "HTTP 302 (redirect"},
		{"compressed stream", func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "text/event-stream")
			w.Header().Set("Content-Encoding", "gzip")
			w.Write([]byte("BODY-CANARY"))
		}, `Content-Encoding "gzip"`},
		{"not a stream", func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "text/html")
			w.Write([]byte("BODY-CANARY"))
		}, `Content-Type is "text/html"`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			srv := httptest.NewServer(tc.handler)
			defer srv.Close()
			code, out, errOut := smoke(t, nil, "-url", srv.URL, "-translate")
			if code != 1 || !strings.Contains(errOut, tc.want) {
				t.Fatalf("exit %d, stderr %q; want 1 containing %q", code, errOut, tc.want)
			}
			assertContentFree(t, out+errOut, "BODY-CANARY")
		})
	}
}

func TestUsage(t *testing.T) {
	env := map[string]string{"VERCEL_AUTOMATION_BYPASS_SECRET": secret}
	for _, args := range [][]string{
		{"-url", "https://example.test"},
		{"-url", "https://example.test", "-translate", "-speech"},
		{"-translate"},
		{"-url", "example.test", "-speech"},
		{"-h"},
	} {
		code, out, errOut := smoke(t, env, args...)
		if code != 2 {
			t.Errorf("%q: exit %d, want 2", args, code)
		}
		// Usage never prints the secret (the flag has no default).
		assertContentFree(t, out+errOut, secret)
		if strings.Contains(out, "billed") {
			t.Errorf("%q: announced a request it must not send", args)
		}
	}
}
