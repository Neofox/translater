package speech_test

import (
	"bytes"
	"context"
	"encoding/json/v2"
	"errors"
	"io"
	"log"
	"log/slog"
	"maps"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"neotranslate/internal/fakeopenai"
	"neotranslate/internal/llm"
	"neotranslate/internal/speech"
)

const fixturesDir = "../../e2e/fixtures/results"

const (
	failedEN = "Pronunciation failed. Please try again."
	failedKO = "발음을 재생하지 못했어요. 다시 시도해 주세요."
	configEN = "Pronunciation is not configured correctly."
	configKO = "발음 재생 설정이 올바르지 않아요."
)

type rig struct {
	app, fake string
}

// newRig serves speech.NewHandler against a fresh fake upstream.
func newRig(t *testing.T, extra map[string]string, timeout time.Duration) rig {
	t.Helper()
	fake := httptest.NewServer(fakeopenai.Handler(fixturesDir))
	t.Cleanup(fake.Close)
	vars := map[string]string{"OPENAI_API_KEY": "test", "OPENAI_BASE_URL": fake.URL + "/v1"}
	maps.Copy(vars, extra)
	getenv := env(vars)
	app := httptest.NewServer(speech.NewHandler(llm.New(getenv), getenv, timeout))
	t.Cleanup(app.Close)
	return rig{app: app.URL, fake: fake.URL}
}

func (r rig) stats(t *testing.T) fakeopenai.Stats {
	t.Helper()
	res, err := http.Get(r.fake + "/_stats")
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

func (r rig) post(t *testing.T, ctx context.Context, text, lang, ui string) (*http.Response, []byte) {
	t.Helper()
	form := url.Values{"text": {text}, "language": {lang}, "uiLang": {ui}}
	req, _ := http.NewRequestWithContext(ctx, "POST", r.app, strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, nil
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)
	return res, body
}

func errorOf(t *testing.T, body []byte) string {
	t.Helper()
	var e struct {
		Error string `json:"error"`
	}
	if err := json.Unmarshal(body, &e); err != nil {
		t.Fatalf("error body %q: %v", body, err)
	}
	return e.Error
}

func TestHandlerStreamsPCM(t *testing.T) {
	r := newRig(t, nil, 90*time.Second)
	res, body := r.post(t, context.Background(), "  안녕하세요  ", "ko", "en")
	if res.StatusCode != 200 {
		t.Fatalf("status %d: %s", res.StatusCode, body)
	}
	if ct := res.Header.Get("Content-Type"); ct != "audio/L16;rate=24000;channels=1" {
		t.Errorf("content type %q", ct)
	}
	if cc := res.Header.Get("Cache-Control"); cc != "no-store" {
		t.Errorf("cache control %q", cc)
	}
	if !bytes.Equal(body, fakeopenai.SpeechTone()) {
		t.Errorf("body is %d B, not the 12,000 B tone", len(body))
	}
	st := r.stats(t)
	if st.SpeechRequests != 1 || len(st.LastSpeechBodies) != 1 {
		t.Fatalf("stats %+v", st)
	}
	var sent map[string]any
	if err := json.Unmarshal([]byte(st.LastSpeechBodies[0]), &sent); err != nil {
		t.Fatal(err)
	}
	want := map[string]any{
		"model": "gpt-4o-mini-tts", "voice": "marin", "input": "안녕하세요", "response_format": "wav",
		"instructions": "Read the text aloud in Korean with natural native pronunciation, at a clear, relaxed pace.",
	}
	if len(sent) != len(want) {
		t.Errorf("sent keys %v", sent)
	}
	for k, v := range want {
		if sent[k] != v {
			t.Errorf("%s = %#v, want %#v", k, sent[k], v)
		}
	}
}

// The browser posts FormData (multipart); model and voice overrides apply.
func TestHandlerMultipartAndOverrides(t *testing.T) {
	r := newRig(t, map[string]string{"SPEECH_MODEL": "tts-1-hd", "SPEECH_VOICE": "voice-id"}, 90*time.Second)
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	mw.WriteField("text", "Bonjour")
	mw.WriteField("language", "fr")
	mw.WriteField("uiLang", "ko")
	mw.Close()
	res, err := http.Post(r.app, mw.FormDataContentType(), &buf)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != 200 || !bytes.Equal(body, fakeopenai.SpeechTone()) {
		t.Fatalf("status %d, %d B", res.StatusCode, len(body))
	}
	var sent map[string]any
	json.Unmarshal([]byte(r.stats(t).LastSpeechBodies[0]), &sent)
	if sent["model"] != "tts-1-hd" || sent["voice"] != "voice-id" || !strings.Contains(sent["instructions"].(string), "in French") {
		t.Errorf("sent %v", sent)
	}
}

func TestHandlerStreamsBigAudio(t *testing.T) {
	r := newRig(t, nil, 90*time.Second)
	res, body := r.post(t, context.Background(), "[fx:speech-big]", "auto", "en")
	if res.StatusCode != 200 || len(body) != 2621440 || !bytes.Equal(body[:12000], fakeopenai.SpeechTone()) {
		t.Fatalf("status %d, %d B", res.StatusCode, len(body))
	}
	var sent map[string]any
	json.Unmarshal([]byte(r.stats(t).LastSpeechBodies[0]), &sent)
	if sent["instructions"] != "Read the text aloud with natural native pronunciation, at a clear, relaxed pace." {
		t.Errorf("auto instructions %v", sent["instructions"])
	}
}

// writes records the size of every Write.
type writes struct {
	*httptest.ResponseRecorder
	sizes   []int
	flushes int
}

func (w *writes) Write(b []byte) (int, error) {
	w.sizes = append(w.sizes, len(b))
	return w.ResponseRecorder.Write(b)
}

func (w *writes) Flush() {
	w.flushes++
	w.ResponseRecorder.Flush()
}

func TestPCMWrittenInFlushedChunks(t *testing.T) {
	fake := httptest.NewServer(fakeopenai.Handler(fixturesDir))
	defer fake.Close()
	getenv := env(map[string]string{"OPENAI_API_KEY": "test", "OPENAI_BASE_URL": fake.URL + "/v1"})
	h := speech.NewHandler(llm.New(getenv), getenv, 90*time.Second)
	form := url.Values{"text": {"[fx:speech-big]"}, "language": {"en"}}
	req := httptest.NewRequest("POST", "/speech", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	w := &writes{ResponseRecorder: httptest.NewRecorder()}
	h.ServeHTTP(w, req)
	if w.Code != 200 || w.Body.Len() != 2621440 {
		t.Fatalf("status %d, %d B", w.Code, w.Body.Len())
	}
	if len(w.sizes) != 80 || w.flushes != 80 {
		t.Fatalf("%d writes, %d flushes", len(w.sizes), w.flushes)
	}
	for i, n := range w.sizes {
		if n != 32768 {
			t.Fatalf("write %d is %d B", i, n)
		}
	}
}

func TestNoRetry(t *testing.T) {
	r := newRig(t, nil, 90*time.Second)
	res, body := r.post(t, context.Background(), "[fx:speech-error]", "en", "en")
	if res.StatusCode != http.StatusBadGateway || errorOf(t, body) != failedEN {
		t.Fatalf("status %d: %s", res.StatusCode, body)
	}
	if st := r.stats(t); st.SpeechRequests != 1 {
		t.Fatalf("speechRequests = %d, want 1", st.SpeechRequests)
	}
}

func TestInvalidWAVIsBadGateway(t *testing.T) {
	r := newRig(t, nil, 90*time.Second)
	res, body := r.post(t, context.Background(), "[fx:speech-bad]", "en", "ko")
	if res.StatusCode != http.StatusBadGateway || errorOf(t, body) != failedKO {
		t.Fatalf("status %d: %s", res.StatusCode, body)
	}
}

// The rate in Content-Type is the one the WAV reports, at both limits.
func TestContentTypeRateFromWAV(t *testing.T) {
	for _, rate := range []uint32{8000, 48000} {
		pcm := []byte{1, 0, 2, 0, 3, 0, 4, 0}
		upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "audio/wav")
			w.Write(wav(pcm, pcm16(rate)))
		}))
		getenv := env(map[string]string{"OPENAI_API_KEY": "test", "OPENAI_BASE_URL": upstream.URL + "/v1"})
		app := httptest.NewServer(speech.NewHandler(llm.New(getenv), getenv, 90*time.Second))
		res, err := http.PostForm(app.URL, url.Values{"text": {"hi"}, "language": {"en"}})
		if err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(res.Body)
		res.Body.Close()
		app.Close()
		upstream.Close()
		want := "audio/L16;rate=" + strconv.Itoa(int(rate)) + ";channels=1"
		if res.StatusCode != 200 || res.Header.Get("Content-Type") != want || !bytes.Equal(body, pcm) {
			t.Errorf("%d Hz: %d %q % x", rate, res.StatusCode, res.Header.Get("Content-Type"), body)
		}
	}
}

// An upstream body over 8 MiB + 64 KiB is rejected without reading it all.
func TestOversizedUpstreamRejected(t *testing.T) {
	var written int64
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "audio/wav")
		n, _ := io.Copy(w, io.LimitReader(zeros{}, 64<<20))
		written = n
	}))
	defer upstream.Close()
	getenv := env(map[string]string{"OPENAI_API_KEY": "test", "OPENAI_BASE_URL": upstream.URL + "/v1"})
	app := httptest.NewServer(speech.NewHandler(llm.New(getenv), getenv, 90*time.Second))
	defer app.Close()
	res, err := http.PostForm(app.URL, url.Values{"text": {"hi"}, "language": {"en"}})
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != http.StatusBadGateway || errorOf(t, body) != failedEN {
		t.Fatalf("status %d: %s", res.StatusCode, body)
	}
	upstream.Close()
	if written >= 64<<20 {
		t.Errorf("the whole 64 MiB body was read")
	}
}

type zeros struct{}

func (zeros) Read(p []byte) (int, error) {
	clear(p)
	return len(p), nil
}

func TestClientAbortCancels(t *testing.T) {
	r := newRig(t, nil, 90*time.Second)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		r.post(t, ctx, "[fx:speech-slow]", "en", "en")
	}()
	deadline := time.Now().Add(2 * time.Second)
	for st := r.stats(t); st.Active != 1; st = r.stats(t) {
		if time.Now().After(deadline) {
			t.Fatalf("upstream never called: %+v", st)
		}
		time.Sleep(10 * time.Millisecond)
	}
	cancel()
	<-done
	for st := r.stats(t); st.SpeechAborted != 1 || st.Active != 0; st = r.stats(t) {
		if time.Now().After(deadline) {
			t.Fatalf("upstream not aborted: %+v", st)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestTimeout(t *testing.T) {
	r := newRig(t, nil, 50*time.Millisecond)
	start := time.Now()
	res, body := r.post(t, context.Background(), "[fx:speech-slow]", "en", "en")
	if elapsed := time.Since(start); elapsed >= 300*time.Millisecond {
		t.Errorf("answered after %v", elapsed)
	}
	if res.StatusCode != http.StatusGatewayTimeout || errorOf(t, body) != failedEN {
		t.Fatalf("status %d: %s", res.StatusCode, body)
	}
	deadline := time.Now().Add(2 * time.Second)
	for st := r.stats(t); st.SpeechAborted != 1 || st.Active != 0; st = r.stats(t) {
		if time.Now().After(deadline) {
			t.Fatalf("upstream not aborted: %+v", st)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestLocalizedErrors(t *testing.T) {
	cases := []struct {
		name   string
		env    map[string]string
		text   string
		lang   string
		status int
		en, ko string
		calls  int
	}{
		{"empty text", nil, "  ", "en", 400, failedEN, failedKO, 0},
		{"too long", nil, strings.Repeat("a", 4001), "en", 400, failedEN, failedKO, 0},
		{"bad language", nil, "hello", "xx", 400, failedEN, failedKO, 0},
		{"model", map[string]string{"SPEECH_MODEL": "private/model"}, "hello", "en", 500, configEN, configKO, 0},
		{"voice", map[string]string{"SPEECH_VOICE": " "}, "hello", "en", 500, configEN, configKO, 0},
		{"missing key", map[string]string{"OPENAI_API_KEY": ""}, "hello", "en", 500, configEN, configKO, 0},
		{"provider", nil, "[fx:speech-error]", "en", 502, failedEN, failedKO, 1},
	}
	for _, c := range cases {
		r := newRig(t, c.env, 90*time.Second)
		for ui, want := range map[string]string{"en": c.en, "ko": c.ko, "": c.en} {
			res, body := r.post(t, context.Background(), c.text, c.lang, ui)
			if res.StatusCode != c.status || errorOf(t, body) != want {
				t.Errorf("%s/%q: %d %s", c.name, ui, res.StatusCode, body)
			}
			if ct := res.Header.Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
				t.Errorf("%s/%q: content type %q", c.name, ui, ct)
			}
			if res.Header.Get("Cache-Control") != "no-store" {
				t.Errorf("%s/%q: cache control %q", c.name, ui, res.Header.Get("Cache-Control"))
			}
		}
		if got := r.stats(t).SpeechRequests; got != c.calls*3 {
			t.Errorf("%s: %d upstream calls", c.name, got)
		}
	}
	// An unknown uiLang is invalid input, answered in English.
	r := newRig(t, nil, 90*time.Second)
	if res, body := r.post(t, context.Background(), "hello", "en", "fr"); res.StatusCode != 400 || errorOf(t, body) != failedEN {
		t.Errorf("uiLang fr: %d %s", res.StatusCode, body)
	}
}

func TestNoContentLogged(t *testing.T) {
	var buf bytes.Buffer
	log.SetOutput(&buf)
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, nil)))
	t.Cleanup(func() {
		log.SetOutput(os.Stderr)
		slog.SetDefault(prev)
	})
	const secret = "PRIVATE-SOURCE-TEXT"
	r := newRig(t, nil, 50*time.Millisecond)
	var bodies []byte
	for _, text := range []string{secret + " [fx:speech-error]", secret + " [fx:speech-bad]", secret + " [fx:speech-slow]", secret + strings.Repeat("a", 4000)} {
		_, body := r.post(t, context.Background(), text, "en", "en")
		bodies = append(bodies, body...)
	}
	for _, leak := range []string{secret, fakeopenai.FaultMessage} {
		if strings.Contains(buf.String(), leak) || strings.Contains(string(bodies), leak) {
			t.Errorf("%s leaked: log %q, bodies %q", leak, buf.String(), bodies)
		}
	}
	if buf.Len() != 0 {
		t.Errorf("speech logged %q", buf.String())
	}
}

// cutOff passes the first n body bytes, then fails every Write, as when the
// platform ends the function mid-response.
type cutOff struct {
	http.ResponseWriter
	n int
}

func (w *cutOff) Write(b []byte) (int, error) {
	if w.n <= 0 {
		return 0, io.ErrClosedPipe
	}
	b = b[:min(len(b), w.n)]
	w.n -= len(b)
	return w.ResponseWriter.Write(b)
}

func (w *cutOff) Unwrap() http.ResponseWriter { return w.ResponseWriter }

// The PCM length is declared up front, so a body cut short is a read error
// for the client, never a shorter clip it could cache as complete (TS's
// stream ends with an explicit done chunk instead).
func TestTruncatedAudioIsAReadError(t *testing.T) {
	r := newRig(t, nil, 90*time.Second)
	res, body := r.post(t, context.Background(), "[fx:speech-big]", "en", "en")
	if res.StatusCode != 200 || res.ContentLength != 2621440 || len(body) != 2621440 {
		t.Fatalf("status %d, Content-Length %q, %d B", res.StatusCode, res.Header.Get("Content-Length"), len(body))
	}

	fake := httptest.NewServer(fakeopenai.Handler(fixturesDir))
	defer fake.Close()
	getenv := env(map[string]string{"OPENAI_API_KEY": "test", "OPENAI_BASE_URL": fake.URL + "/v1"})
	h := speech.NewHandler(llm.New(getenv), getenv, 90*time.Second)
	app := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		h.ServeHTTP(&cutOff{ResponseWriter: w, n: 100_000}, req)
	}))
	defer app.Close()
	cut, err := http.PostForm(app.URL, url.Values{"text": {"[fx:speech-big]"}, "language": {"en"}})
	if err != nil {
		t.Fatal(err)
	}
	defer cut.Body.Close()
	got, err := io.ReadAll(cut.Body)
	if !errors.Is(err, io.ErrUnexpectedEOF) {
		t.Fatalf("read %d B, err %v: want io.ErrUnexpectedEOF", len(got), err)
	}
}
