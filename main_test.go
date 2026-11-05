package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

// An invalid TRANSLATE_* value keeps the page and assets up; each run ends
// with the localized configuration error and never reaches upstream.
func TestInvalidConfigServesPageAndConfigurationError(t *testing.T) {
	upstreamCalls := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		upstreamCalls++
		http.Error(w, "unexpected", http.StatusInternalServerError)
	}))
	defer upstream.Close()
	env := map[string]string{
		"OPENAI_API_KEY": "test", "OPENAI_BASE_URL": upstream.URL + "/v1",
		"TRANSLATE_REASONING": "extreme",
	}
	mux, err := newMux(func(k string) string { return env[k] })
	if err != nil {
		t.Fatalf("newMux: %v", err)
	}
	srv := httptest.NewServer(mux)
	defer srv.Close()

	res, err := http.Get(srv.URL + "/")
	if err != nil {
		t.Fatal(err)
	}
	page, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != 200 || !strings.Contains(string(page), `data-testid="input-textarea"`) {
		t.Fatalf("GET / = %d", res.StatusCode)
	}
	css := between(string(page), `<link rel="stylesheet" href="`, `"`)
	if res, err := http.Get(srv.URL + css); err != nil || res.StatusCode != 200 {
		t.Fatalf("GET %s failed", css)
	}

	for ui, want := range map[string]string{
		"en": "OpenAI is not configured for this deployment.",
		"ko": "이 배포 환경에 OpenAI가 설정되어 있지 않습니다.",
	} {
		form := url.Values{
			"run": {"r1"}, "text": {"hello there friend"}, "source": {"en"}, "target": {"ko"},
			"mode": {"casual"}, "intent": {"sentence"}, "uiLang": {ui},
		}
		res, err := http.PostForm(srv.URL+"/translate", form)
		if err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(res.Body)
		res.Body.Close()
		if !strings.HasPrefix(res.Header.Get("Content-Type"), "text/event-stream") {
			t.Fatalf("%s: content type %q", ui, res.Header.Get("Content-Type"))
		}
		wantEvent := `event: nt-error` + "\n" + `data: {"run":"r1","kind":"configuration","key":"providerConfigurationFailed","message":"` + want + `"}`
		if !strings.Contains(string(body), wantEvent) || strings.Contains(string(body), "nt-done") {
			t.Errorf("%s: stream = %s", ui, body)
		}
		if strings.Contains(string(body), "extreme") || strings.Contains(string(body), "TRANSLATE_") {
			t.Errorf("%s: configuration details leaked", ui)
		}
	}
	// Invalid input is still a 400 before any stream.
	res, err = http.PostForm(srv.URL+"/translate", url.Values{"run": {"bad id!"}})
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusBadRequest {
		t.Errorf("invalid run = %d, want 400", res.StatusCode)
	}
	if upstreamCalls != 0 {
		t.Errorf("upstream called %d times", upstreamCalls)
	}
}

// POST /speech is routed: an invalid SPEECH_MODEL keeps the page up and
// answers with the localized configuration error, never calling upstream;
// GET is not routed.
func TestSpeechRoute(t *testing.T) {
	upstreamCalls := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		upstreamCalls++
		http.Error(w, "unexpected", http.StatusInternalServerError)
	}))
	defer upstream.Close()
	env := map[string]string{
		"OPENAI_API_KEY": "test", "OPENAI_BASE_URL": upstream.URL + "/v1",
		"SPEECH_MODEL": "openai/gpt-4o-mini-tts",
	}
	mux, err := newMux(func(k string) string { return env[k] })
	if err != nil {
		t.Fatalf("newMux: %v", err)
	}
	srv := httptest.NewServer(mux)
	defer srv.Close()
	if res, err := http.Get(srv.URL + "/"); err != nil || res.StatusCode != 200 {
		t.Fatalf("GET / failed")
	}
	res, err := http.PostForm(srv.URL+"/speech", url.Values{"text": {"안녕"}, "language": {"ko"}, "uiLang": {"ko"}})
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != 500 || string(body) != `{"error":"발음 재생 설정이 올바르지 않아요."}` {
		t.Errorf("POST /speech = %d %s", res.StatusCode, body)
	}
	if res, err := http.Get(srv.URL + "/speech"); err != nil || res.StatusCode != http.StatusMethodNotAllowed {
		t.Errorf("GET /speech = %v, %v", res.StatusCode, err)
	}
	if upstreamCalls != 0 {
		t.Errorf("upstream called %d times", upstreamCalls)
	}
}

// The Vercel Web Analytics script exists only on Vercel, which sets VERCEL
// (and VERCEL_ENV) in its runtime; elsewhere the page must not request it.
func TestVercelAnalyticsOnlyOnVercel(t *testing.T) {
	const tag = `<script defer src="/_vercel/insights/script.js"></script></head>`
	for _, tc := range []struct {
		env  map[string]string
		want bool
	}{
		{map[string]string{}, false},
		{map[string]string{"VERCEL": "1"}, true},
		{map[string]string{"VERCEL_ENV": "preview"}, true},
	} {
		mux, err := newMux(func(k string) string { return tc.env[k] })
		if err != nil {
			t.Fatal(err)
		}
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
		if got := strings.Contains(rec.Body.String(), tag); got != tc.want {
			t.Errorf("env %v: analytics tag present = %v, want %v", tc.env, got, tc.want)
		}
	}
}

func between(s, start, end string) string {
	_, after, _ := strings.Cut(s, start)
	v, _, _ := strings.Cut(after, end)
	return v
}
