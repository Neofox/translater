package translate

import (
	"bufio"
	"context"
	"encoding/json/jsontext"
	"encoding/json/v2"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"neotranslate/internal/config"
	"neotranslate/internal/contract"
	"neotranslate/internal/fakeopenai"
	"neotranslate/internal/jsonstream"
	"neotranslate/internal/llm"
)

const fixturesDir = "../../../e2e/fixtures/results"

type sseEvent struct {
	Name string // "" for unnamed (partial) messages
	Data string
}

func (e sseEvent) json(t *testing.T) map[string]string {
	t.Helper()
	var m map[string]string
	if err := json.Unmarshal([]byte(e.Data), &m); err != nil {
		t.Fatalf("%s data %q: %v", e.Name, e.Data, err)
	}
	return m
}

// parseSSE splits a complete event stream (all three line terminators).
func parseSSE(t *testing.T, raw string) []sseEvent {
	t.Helper()
	raw = strings.NewReplacer("\r\n", "\n", "\r", "\n").Replace(raw)
	var out []sseEvent
	for _, block := range strings.Split(raw, "\n\n") {
		if block == "" {
			continue
		}
		var ev sseEvent
		var data []string
		for _, line := range strings.Split(block, "\n") {
			switch {
			case strings.HasPrefix(line, "event: "):
				ev.Name = strings.TrimPrefix(line, "event: ")
			case strings.HasPrefix(line, "data: "):
				data = append(data, strings.TrimPrefix(line, "data: "))
			default:
				t.Fatalf("unexpected SSE line %q", line)
			}
		}
		ev.Data = strings.Join(data, "\n")
		out = append(out, ev)
	}
	return out
}

type env struct {
	app      *httptest.Server
	upstream *httptest.Server
	c        *contract.Contract
	s        *Server
}

func newEnv(t *testing.T, dir string, vars map[string]string) *env {
	t.Helper()
	upstream := httptest.NewServer(fakeopenai.Handler(dir))
	t.Cleanup(upstream.Close)
	all := map[string]string{"OPENAI_API_KEY": "test-key", "OPENAI_BASE_URL": upstream.URL + "/v1"}
	for k, v := range vars {
		all[k] = v
	}
	getenv := func(k string) string { return all[k] }
	c, err := contract.Load()
	if err != nil {
		t.Fatal(err)
	}
	cfg, err := config.LoadTranslate(getenv)
	if err != nil {
		t.Fatal(err)
	}
	s := NewServer(c, cfg, llm.New(getenv))
	mux := http.NewServeMux()
	mux.HandleFunc("POST /translate", s.HandleTranslate)
	mux.HandleFunc("POST /warm", s.HandleWarm)
	app := httptest.NewServer(mux)
	t.Cleanup(app.Close)
	return &env{app: app, upstream: upstream, c: c, s: s}
}

func form(text string, extra ...string) url.Values {
	v := url.Values{
		"run": {"run-1"}, "text": {text}, "source": {"en"}, "target": {"ko"},
		"mode": {"casual"}, "intent": {"sentence"}, "uiLang": {"en"},
	}
	for i := 0; i+1 < len(extra); i += 2 {
		if extra[i+1] == "\x00delete" {
			v.Del(extra[i])
			continue
		}
		v.Set(extra[i], extra[i+1])
	}
	return v
}

func (e *env) post(t *testing.T, ctx context.Context, v url.Values) *http.Response {
	t.Helper()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, e.app.URL+"/translate", strings.NewReader(v.Encode()))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	return resp
}

// run posts v and returns the raw complete stream.
func (e *env) run(t *testing.T, v url.Values) string {
	t.Helper()
	resp := e.post(t, context.Background(), v)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("status %d: %s", resp.StatusCode, b)
	}
	for k, want := range map[string]string{
		"Content-Type":      "text/event-stream",
		"Cache-Control":     "no-cache, no-transform",
		"X-Accel-Buffering": "no",
	} {
		if got := resp.Header.Get(k); got != want {
			t.Errorf("%s = %q, want %q", k, got, want)
		}
	}
	b, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func (e *env) stats(t *testing.T) fakeopenai.Stats {
	t.Helper()
	resp, err := http.Get(e.upstream.URL + "/_stats")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var st fakeopenai.Stats
	if err := json.UnmarshalRead(resp.Body, &st); err != nil {
		t.Fatal(err)
	}
	return st
}

func names(evs []sseEvent) []string {
	out := make([]string, len(evs))
	for i, e := range evs {
		out[i] = e.Name
	}
	return out
}

func index(evs []sseEvent, name string) int {
	return slices.IndexFunc(evs, func(e sseEvent) bool { return e.Name == name })
}

func joined(t *testing.T, evs []sseEvent, name, field string) string {
	var b strings.Builder
	for _, e := range evs {
		if e.Name != name {
			continue
		}
		m := e.json(t)
		if field != "" && m["field"] != field {
			continue
		}
		b.WriteString(m["text"])
	}
	return b.String()
}

func partials(evs []sseEvent) []string {
	var out []string
	for _, e := range evs {
		if e.Name == "" {
			out = append(out, e.Data)
		}
	}
	return out
}

type fixture struct {
	Result map[string]any `json:"result"`
}

func loadFixture(t *testing.T, name string) fixture {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(fixturesDir, name))
	if err != nil {
		t.Fatal(err)
	}
	var f fixture
	if err := json.Unmarshal(b, &f); err != nil {
		t.Fatal(err)
	}
	return f
}

func TestEventOrder(t *testing.T) {
	e := newEnv(t, fixturesDir, nil)
	raw := e.run(t, form("How are you doing today?"))
	evs := parseSSE(t, raw)
	want := loadFixture(t, "default.json").Result

	if len(evs) == 0 || evs[0].Name != "" || !strings.Contains(evs[0].Data, `hx-target="#result-details"`) ||
		!strings.Contains(evs[0].Data, `id="alternatives"`) {
		t.Fatalf("first message is not the result skeleton: %+v", evs[:min(1, len(evs))])
	}
	src, delta, ready := index(evs, evSourceLang), index(evs, evMainDelta), index(evs, evMainReady)
	if src < 0 || delta < 0 || ready < 0 || !(src < delta && delta < ready) {
		t.Fatalf("want source-lang < main-delta < main-ready, got %v", names(evs))
	}
	if got := evs[src].json(t)["lang"]; got != "en" {
		t.Errorf("source-lang = %q", got)
	}
	if got := joined(t, evs, evMainDelta, ""); got != want["main"] {
		t.Errorf("main deltas = %q, want %q", got, want["main"])
	}
	if got := evs[ready].json(t)["main"]; got != want["main"] {
		t.Errorf("main-ready = %q", got)
	}
	if n := strings.Count(strings.Join(names(evs), ","), evMainReady); n != 1 {
		t.Errorf("main-ready fired %d times", n)
	}
	if got := joined(t, evs, evTextDelta, "rationale"); got != want["rationale"] {
		t.Errorf("rationale deltas = %q", got)
	}
	for _, ev := range evs {
		if ev.Name != "" && ev.json(t)["run"] != "run-1" {
			t.Errorf("%s without run id: %s", ev.Name, ev.Data)
		}
	}
	rows := 0
	for _, p := range partials(evs)[1:] {
		if !strings.HasPrefix(p, `<hx-partial hx-target="#alternatives" hx-swap="beforeend">`) ||
			!strings.Contains(p, `data-testid="alternative-item"`) {
			t.Errorf("unexpected partial %q", p)
		}
		rows++
	}
	if rows != len(want["alternatives"].([]any)) {
		t.Errorf("%d alternative rows", rows)
	}
	if last := evs[len(evs)-1]; last.Name != evDone {
		t.Errorf("last event %q, want nt-done", last.Name)
	}
	if index(evs, evError) >= 0 {
		t.Error("unexpected nt-error")
	}
}

// TestMainReadyBeforeLearningPhrases feeds the fixture as the fake streams it
// and checks main-ready was written before any learningPhrases value closes.
func TestMainReadyBeforeLearningPhrases(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join(fixturesDir, "default.json"))
	if err != nil {
		t.Fatal(err)
	}
	var f struct {
		Result jsontext.Value `json:"result"`
	}
	if err := json.Unmarshal(raw, &f); err != nil {
		t.Fatal(err)
	}
	doc := string(f.Result)
	var b strings.Builder
	p := newTestProcessor(t, &b, "sentence")
	probe := jsonstream.New()
	rs := []rune(doc)
	sawPhrase := false
	for i := 0; i < len(rs); i += 12 {
		chunk := string(rs[i:min(i+12, len(rs))])
		if err := p.feed(chunk); err != nil {
			t.Fatal(err)
		}
		evs, err := probe.Feed(chunk)
		if err != nil {
			t.Fatal(err)
		}
		for _, ev := range evs {
			if ev.Kind == jsonstream.ValueEnd && len(ev.Path) >= 2 && ev.Path[0].Key == "learningPhrases" {
				sawPhrase = true
			}
		}
		if sawPhrase {
			if !strings.Contains(b.String(), "event: "+evMainReady) {
				t.Fatal("a learningPhrases value completed before main-ready was written")
			}
			return
		}
	}
	t.Fatal("fixture has no learningPhrases values")
}

func newTestProcessor(t *testing.T, w io.Writer, intent string) *processor {
	t.Helper()
	c, err := contract.Load()
	if err != nil {
		t.Fatal(err)
	}
	out := &sseWriter{w: w, flush: func() error { return nil }}
	return newProcessor(out, c, "run-1", intent, "en")
}

func TestDuplicateMainKey(t *testing.T) {
	var b strings.Builder
	p := newTestProcessor(t, &b, "sentence")
	for _, chunk := range []string{`{"sourceLang":"en","targetLang":"ko","main":" a `, `","main":"b","sourceLang":"ko"`, `,"rationale":"r","rationale":"s"}`} {
		if err := p.feed(chunk); err != nil {
			t.Fatal(err)
		}
	}
	evs := parseSSE(t, b.String())
	var got []string
	for _, ev := range evs {
		if ev.Name != "" {
			got = append(got, ev.Name+" "+ev.Data)
		}
	}
	want := []string{
		`nt-source-lang {"run":"run-1","lang":"en"}`,
		`nt-main-delta {"run":"run-1","text":" a "}`,
		`nt-main-ready {"run":"run-1","main":"a"}`,
		`nt-text-delta {"run":"run-1","field":"rationale","text":"r"}`,
	}
	if !slices.Equal(got, want) {
		t.Fatalf("events:\n%s\nwant:\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
	}
	s, err := compileSchemas(p.c)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := p.finish(s["sentence"]); err == nil {
		t.Fatal("a document with duplicate keys passed final validation")
	}
}

func TestMalformedStopsProcessing(t *testing.T) {
	var b strings.Builder
	p := newTestProcessor(t, &b, "sentence")
	if err := p.feed(`{"sourceLang":"en"}x`); err != errMalformed {
		t.Fatalf("feed = %v, want errMalformed", err)
	}
	if strings.Contains(b.String(), evSourceLang) {
		t.Error("events completed in a malformed chunk were emitted")
	}
}

func TestPartialSplitsEveryLineBreak(t *testing.T) {
	var b strings.Builder
	out := &sseWriter{w: &b, flush: func() error { return nil }}
	out.partial("a\r\nb\rc\n\nd")
	if want := "data: a\ndata: b\ndata: c\ndata: \ndata: d\n\n"; b.String() != want {
		t.Fatalf("got %q, want %q", b.String(), want)
	}
}

func TestResponseClosedAfterDone(t *testing.T) {
	e := newEnv(t, fixturesDir, nil)
	raw := e.run(t, form("How are you doing today?"))
	if suffix := "event: nt-done\ndata: {\"run\":\"run-1\"}\n\n"; !strings.HasSuffix(raw, suffix) {
		t.Fatalf("stream does not end right after nt-done: ...%q", raw[max(0, len(raw)-120):])
	}
	if strings.Count(raw, "event: nt-done") != 1 {
		t.Error("more than one nt-done")
	}
	raw = e.run(t, form("[fx:error-rate] hi"))
	evs := parseSSE(t, raw)
	if last := evs[len(evs)-1]; last.Name != evError || !strings.HasSuffix(raw, last.Data+"\n\n") {
		t.Fatalf("stream does not end right after nt-error: %v", names(evs))
	}
}

func TestCacheHitNoUpstream(t *testing.T) {
	e := newEnv(t, fixturesDir, nil)
	first := parseSSE(t, e.run(t, form("How are you doing today?")))
	second := parseSSE(t, e.run(t, form("  How are you doing today?\n", "run", "run-2")))
	if st := e.stats(t); st.Requests != 1 {
		t.Fatalf("upstream requests = %d, want 1 (second run must hit the cache)", st.Requests)
	}
	// Same sequence, except that live deltas arrive in several pieces.
	collapse := func(evs []sseEvent) []string {
		var out []string
		for _, ev := range evs {
			n := ev.Name
			if n == evTextDelta {
				n += ":" + ev.json(t)["field"]
			}
			if n == "" {
				n = ev.Data
			}
			if len(out) > 0 && out[len(out)-1] == n && (ev.Name == evMainDelta || ev.Name == evTextDelta) {
				continue
			}
			out = append(out, n)
		}
		return out
	}
	if a, b := collapse(first), collapse(second); !slices.Equal(a, b) {
		t.Fatalf("cache hit sequence differs:\n%v\n%v", a, b)
	}
	if a, b := joined(t, first, evMainDelta, ""), joined(t, second, evMainDelta, ""); a != b {
		t.Errorf("main %q != %q", a, b)
	}
	if got := second[index(second, evMainReady)].json(t)["run"]; got != "run-2" {
		t.Errorf("cache hit run = %q, want run-2", got)
	}
	// The UI language is part of the key: switching it is a real re-run.
	e.run(t, form("How are you doing today?", "uiLang", "ko"))
	if st := e.stats(t); st.Requests != 2 {
		t.Fatalf("upstream requests = %d, want 2 after a UI language change", st.Requests)
	}
}

func lastError(t *testing.T, raw string) map[string]string {
	t.Helper()
	evs := parseSSE(t, raw)
	last := evs[len(evs)-1]
	if last.Name != evError {
		t.Fatalf("last event %q, want nt-error (%v)", last.Name, names(evs))
	}
	if index(evs, evDone) >= 0 {
		t.Fatal("nt-done alongside nt-error")
	}
	return last.json(t)
}

func TestErrorLocalized(t *testing.T) {
	e := newEnv(t, fixturesDir, nil)
	raw := e.run(t, form("[fx:error-budget] hi", "uiLang", "ko"))
	got := lastError(t, raw)
	if got["kind"] != "budget" || got["message"] != e.c.T("ko", "providerBudgetUnavailable") || got["run"] != "run-1" {
		t.Errorf("error = %v", got)
	}
	if strings.Contains(raw, "quota") {
		t.Error("provider text leaked")
	}
	// Absent uiLang defaults to English.
	got = lastError(t, e.run(t, form("[fx:error-rate] hi", "uiLang", "\x00delete")))
	if got["kind"] != "rate_limit" || got["message"] != e.c.T("en", "providerRateLimited") {
		t.Errorf("error = %v", got)
	}
	for fx, kind := range map[string]string{
		"error-auth": "authentication", "error-model": "model_configuration", "error-provider": "provider",
	} {
		got := lastError(t, e.run(t, form("[fx:"+fx+"] hi")))
		if got["kind"] != kind {
			t.Errorf("%s: kind %q, want %q", fx, got["kind"], kind)
		}
	}
}

func TestMissingAPIKeyIsConfiguration(t *testing.T) {
	e := newEnv(t, fixturesDir, map[string]string{"OPENAI_API_KEY": ""})
	got := lastError(t, e.run(t, form("hi there friend")))
	if got["kind"] != "configuration" || got["message"] != e.c.T("en", "providerConfigurationFailed") {
		t.Errorf("error = %v", got)
	}
}

// writeFixtures makes a fixtures dir holding default.json plus extra files.
func writeFixtures(t *testing.T, extra map[string]string) string {
	t.Helper()
	dir := t.TempDir()
	def, err := os.ReadFile(filepath.Join(fixturesDir, "default.json"))
	if err != nil {
		t.Fatal(err)
	}
	files := map[string]string{"default.json": string(def)}
	for k, v := range extra {
		files[k] = v
	}
	for name, body := range files {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

func TestSchemaFailureIsStructuredOutputAndNotCached(t *testing.T) {
	dir := writeFixtures(t, map[string]string{
		"bad.json": `{"match":"[fx:bad]","intent":"sentence","delayMs":0,"result":{"sourceLang":"en","targetLang":"ko","main":"x"}}`,
		"incomplete.json": `{"match":"[fx:incomplete]","intent":"sentence","delayMs":0,"chunk":5,
			"result":{"sourceLang":"en","targetLang":"ko","main":"hello there"},
			"fault":{"kind":"incomplete","after":2,"reason":"max_output_tokens"}}`,
	})
	e := newEnv(t, dir, nil)
	for range 2 {
		got := lastError(t, e.run(t, form("[fx:bad] hi")))
		if got["kind"] != "structured_output" || got["message"] != e.c.T("en", "providerStructuredOutputInvalid") {
			t.Errorf("error = %v", got)
		}
	}
	if st := e.stats(t); st.Requests != 2 {
		t.Errorf("upstream requests = %d, want 2 (invalid results are not cached)", st.Requests)
	}
	if got := lastError(t, e.run(t, form("[fx:incomplete] hi"))); got["kind"] != "structured_output" {
		t.Errorf("incomplete: %v", got)
	}
}

func TestMarkupEscaped(t *testing.T) {
	e := newEnv(t, fixturesDir, nil)
	raw := e.run(t, form("[fx:markup] hi"))
	evs := parseSSE(t, raw)
	want := loadFixture(t, "markup.json").Result
	if got := joined(t, evs, evMainDelta, ""); got != want["main"] {
		t.Errorf("main deltas = %q, want raw %q", got, want["main"])
	}
	if got := evs[index(evs, evMainReady)].json(t)["main"]; got != want["main"] {
		t.Errorf("main-ready = %q", got)
	}
	if got := joined(t, evs, evTextDelta, "rationale"); got != want["rationale"] {
		t.Errorf("rationale deltas = %q", got)
	}
	html := strings.Join(partials(evs), "\n")
	for _, s := range []string{"&lt;b&gt;bold&lt;/b&gt; &amp; &lt;script&gt;alert(1)&lt;/script&gt;"} {
		if !strings.Contains(html, s) {
			t.Errorf("partials lack escaped %q:\n%s", s, html)
		}
	}
	for _, s := range []string{"<b>", "<script", "<img"} {
		if strings.Contains(html, s) {
			t.Errorf("partials contain raw %q", s)
		}
	}
	// The main text never reaches HTML: the fake's \u003c escapes arrive decoded.
	if !strings.Contains(raw, `"text":"<img`) {
		t.Errorf("main delta JSON does not carry the raw string")
	}
}

func TestMarkupEscapedInRowsAndRationalePartial(t *testing.T) {
	// The markup fixture puts <img in main/rationale only; check a row too.
	dir := writeFixtures(t, map[string]string{
		"row.json": `{"match":"[fx:row]","intent":"sentence","delayMs":0,"result":{"sourceLang":"en","targetLang":"ko","main":"m","learningPhrases":[],"rationale":"r",
			"alternatives":[{"text":"<img src=x onerror=alert(1)>","note":"</textarea>\r\nline"}],"formalityNote":""}}`,
	})
	e := newEnv(t, dir, nil)
	evs := parseSSE(t, e.run(t, form("[fx:row] hi")))
	rows := partials(evs)[1:]
	if len(rows) != 1 || !strings.Contains(rows[0], "&lt;img src=x onerror=alert(1)&gt;") ||
		!strings.Contains(rows[0], "&lt;/textarea&gt;") || strings.Contains(rows[0], "<img") {
		t.Fatalf("row not escaped: %q", rows)
	}
}

func TestWordEvents(t *testing.T) {
	e := newEnv(t, fixturesDir, nil)
	evs := parseSSE(t, e.run(t, form("[fx:word] thanks", "intent", "word")))
	want := loadFixture(t, "word.json").Result
	if got := joined(t, evs, evMainDelta, ""); got != want["primaryTranslation"] {
		t.Errorf("main deltas = %q", got)
	}
	if got := evs[index(evs, evMainReady)].json(t)["main"]; got != want["primaryTranslation"] {
		t.Errorf("main-ready = %q", got)
	}
	if got := joined(t, evs, evTextDelta, "primaryUsageNote"); got != want["primaryUsageNote"] {
		t.Errorf("usage deltas = %q", got)
	}
	ps := partials(evs)
	if !strings.Contains(ps[0], e.c.T("en", "alternativeTranslations")) {
		t.Errorf("skeleton title: %q", ps[0])
	}
	if len(ps) != 4 || !strings.Contains(ps[1], ">casual polite</span>") ||
		!strings.Contains(ps[1], `class="flex flex-wrap items-baseline gap-2"`) {
		t.Errorf("word rows: %q", ps[1:])
	}
	if evs[len(evs)-1].Name != evDone {
		t.Errorf("last = %q", evs[len(evs)-1].Name)
	}
}

func TestDisconnectCancels(t *testing.T) {
	e := newEnv(t, fixturesDir, nil)
	ctx, cancel := context.WithCancel(context.Background())
	resp := e.post(t, ctx, form("[fx:slow] hi"))
	sc := bufio.NewScanner(resp.Body)
	for sc.Scan() {
		if strings.HasPrefix(sc.Text(), "event: "+evSourceLang) {
			break
		}
	}
	cancel()
	resp.Body.Close()
	deadline := time.Now().Add(5 * time.Second)
	for {
		st := e.stats(t)
		if st.Aborted == 1 && st.Active == 0 {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("upstream not cancelled: %+v", st)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func TestInvalidInput400(t *testing.T) {
	e := newEnv(t, fixturesDir, nil)
	long := strings.Repeat("a", e.c.Limits.MaxInputChars+1)
	cases := map[string]url.Values{
		"empty text":        form(""),
		"text too long":     form(long),
		"context too long":  form("hi", "context", strings.Repeat("c", e.c.Limits.MaxContextChars+1)),
		"bad target":        form("hi", "target", "xx"),
		"bad uiLang":        form("hi", "uiLang", "fr"),
		"missing run":       form("hi", "run", "\x00delete"),
		"bad run":           form("hi", "run", "<x>"),
		"invalid UTF-8":     form("hi \xff there"),
		"invalid UTF-8 ctx": form("hi", "context", "\xc3"),
	}
	refs := form("hi")
	refs["refinements"] = []string{"a", "b", "c", "d"}
	cases["too many refinements"] = refs
	longRef := form("hi")
	longRef["refinements"] = []string{strings.Repeat("r", e.c.Limits.MaxRefinementChars+1)}
	cases["refinement too long"] = longRef
	for name, v := range cases {
		resp := e.post(t, context.Background(), v)
		b, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if resp.StatusCode != http.StatusBadRequest {
			t.Errorf("%s: status %d, want 400", name, resp.StatusCode)
		}
		if strings.Contains(string(b), "hi") && name != "missing run" {
			t.Errorf("%s: body echoes input: %q", name, b)
		}
	}
	if st := e.stats(t); st.Requests != 0 {
		t.Errorf("upstream requests = %d, want 0", st.Requests)
	}
}

func TestEmptyRefinementInputIgnoredAndMultipartAccepted(t *testing.T) {
	e := newEnv(t, fixturesDir, nil)
	v := form("How are you doing today?")
	v["refinements"] = []string{""}
	if evs := parseSSE(t, e.run(t, v)); evs[len(evs)-1].Name != evDone {
		t.Fatalf("empty refinements input: %v", names(evs))
	}
	var body strings.Builder
	body.WriteString("--b\r\n")
	for _, k := range []string{"run", "text", "source", "target", "mode", "intent", "uiLang"} {
		fmt.Fprintf(&body, "Content-Disposition: form-data; name=%q\r\n\r\n%s\r\n--b\r\n", k, v.Get(k))
	}
	mp := strings.TrimSuffix(body.String(), "\r\n") + "--\r\n"
	req, _ := http.NewRequest(http.MethodPost, e.app.URL+"/translate", strings.NewReader(mp))
	req.Header.Set("Content-Type", "multipart/form-data; boundary=b")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || !strings.HasSuffix(string(b), "event: nt-done\ndata: {\"run\":\"run-1\"}\n\n") {
		t.Fatalf("multipart: %d %q", resp.StatusCode, b)
	}
}

func TestWarm(t *testing.T) {
	e := newEnv(t, fixturesDir, nil)
	resp, err := http.Post(e.app.URL+"/warm", "", nil)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		t.Errorf("status %d", resp.StatusCode)
	}
	if st := e.stats(t); st.Requests != 0 {
		t.Errorf("warm made %d upstream requests", st.Requests)
	}
}

// failingWriter accepts the headers and the first frames, then every write
// fails, as when the client has gone but the host never cancels the request
// context (Vercel).
type failingWriter struct {
	header http.Header
	frames int
}

func (f *failingWriter) Header() http.Header { return f.header }
func (f *failingWriter) WriteHeader(int)     {}
func (f *failingWriter) Flush()              {}
func (f *failingWriter) Write(b []byte) (int, error) {
	if f.frames >= 3 {
		return 0, io.ErrClosedPipe
	}
	f.frames++
	return len(b), nil
}

func TestWriteFailureCancelsUpstream(t *testing.T) {
	e := newEnv(t, fixturesDir, nil)
	req := httptest.NewRequest(http.MethodPost, "/translate", strings.NewReader(form("[fx:slow] hi").Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	done := make(chan struct{})
	go func() {
		e.s.HandleTranslate(&failingWriter{header: http.Header{}}, req)
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(3 * time.Second): // slow.json streams for ~10s
		t.Fatal("handler kept streaming after writes failed")
	}
	deadline := time.Now().Add(5 * time.Second)
	for st := e.stats(t); st.Aborted != 1 || st.Active != 0; st = e.stats(t) {
		if time.Now().After(deadline) {
			t.Fatalf("upstream not cancelled: %+v", st)
		}
		time.Sleep(20 * time.Millisecond)
	}
}
