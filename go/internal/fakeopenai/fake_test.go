package fakeopenai_test

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json/jsontext"
	"encoding/json/v2"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/santhosh-tekuri/jsonschema/v6"

	"neotranslate/internal/fakeopenai"
)

const fixturesDir = "../../../e2e/fixtures/results"

type event struct {
	Name string
	Data map[string]any
}

func post(t *testing.T, ctx context.Context, url, userText string) *http.Response {
	t.Helper()
	body, _ := json.Marshal(map[string]any{
		"model":  "fake-model",
		"stream": true,
		"input": []any{
			map[string]any{"role": "developer", "content": "language rule"},
			map[string]any{"role": "user", "content": []any{
				map[string]any{"type": "input_text", "text": "stable reminder"},
				map[string]any{"type": "input_text", "text": userText},
			}},
		},
	})
	req, _ := http.NewRequestWithContext(ctx, "POST", url+"/v1/responses", strings.NewReader(string(body)))
	req.Header.Set("Content-Type", "application/json")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	return res
}

func readEvents(t *testing.T, r io.Reader) []event {
	t.Helper()
	var out []event
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 1<<20), 1<<20)
	var name string
	for sc.Scan() {
		line := sc.Text()
		switch {
		case strings.HasPrefix(line, "event: "):
			name = strings.TrimPrefix(line, "event: ")
		case strings.HasPrefix(line, "data: "):
			var d map[string]any
			if err := json.Unmarshal([]byte(strings.TrimPrefix(line, "data: ")), &d); err != nil {
				t.Fatal(err)
			}
			out = append(out, event{name, d})
		}
	}
	return out
}

func loadFixture(t *testing.T, file string) fakeopenai.Fixture {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(fixturesDir, file))
	if err != nil {
		t.Fatal(err)
	}
	var f fakeopenai.Fixture
	if err := json.Unmarshal(raw, &f); err != nil {
		t.Fatal(err)
	}
	return f
}

func TestStreamsFixtureAsResponsesSSE(t *testing.T) {
	srv := httptest.NewServer(fakeopenai.Handler(fixturesDir))
	defer srv.Close()
	fx := loadFixture(t, "plain.json")

	res := post(t, context.Background(), srv.URL, "hello "+fx.Match)
	defer res.Body.Close()
	if ct := res.Header.Get("Content-Type"); ct != "text/event-stream" {
		t.Fatalf("content-type %q", ct)
	}
	events := readEvents(t, res.Body)

	var got strings.Builder
	var names []string
	for i, e := range events {
		names = append(names, e.Name)
		if e.Data["type"] != e.Name {
			t.Fatalf("event %s has type %v", e.Name, e.Data["type"])
		}
		if int(e.Data["sequence_number"].(float64)) != i {
			t.Fatalf("sequence_number %v at %d", e.Data["sequence_number"], i)
		}
		if e.Name == "response.output_text.delta" {
			got.WriteString(e.Data["delta"].(string))
			for _, k := range []string{"item_id", "output_index", "content_index"} {
				if _, ok := e.Data[k]; !ok {
					t.Fatalf("delta missing %s", k)
				}
			}
		}
	}
	want, _ := json.Marshal(fx.Result, jsontext.EscapeForHTML(true))
	if got.String() != string(want) {
		t.Fatalf("deltas differ:\n got %s\nwant %s", got.String(), want)
	}
	if names[0] != "response.created" || names[len(names)-1] != "response.completed" {
		t.Fatalf("event order %v", names)
	}
	usage := events[len(events)-1].Data["response"].(map[string]any)["usage"].(map[string]any)
	if usage["input_tokens"] == nil || usage["output_tokens"] == nil {
		t.Fatalf("usage missing: %v", usage)
	}
}

func TestSplitsFallInsideEscapes(t *testing.T) {
	srv := httptest.NewServer(fakeopenai.Handler(fixturesDir))
	defer srv.Close()
	fx := loadFixture(t, "markup.json")
	res := post(t, context.Background(), srv.URL, fx.Match)
	defer res.Body.Close()
	var deltas []string
	for _, e := range readEvents(t, res.Body) {
		if e.Name == "response.output_text.delta" {
			deltas = append(deltas, e.Data["delta"].(string))
		}
	}
	// Some chunk must end inside a \uXXXX or \" escape.
	split := false
	for _, d := range deltas[:len(deltas)-1] {
		if i := strings.LastIndex(d, `\`); i >= 0 && len(d)-i < 6 && !strings.HasSuffix(d, `\\`) {
			split = true
		}
	}
	if !split {
		t.Fatalf("no delta boundary falls inside an escape: %q", deltas)
	}
	if strings.Contains(strings.Join(deltas, ""), "<img") {
		t.Fatal("markup must be HTML-escaped on the wire")
	}
}

func TestEmojiFixtureEscapesSurrogates(t *testing.T) {
	srv := httptest.NewServer(fakeopenai.Handler(fixturesDir))
	defer srv.Close()
	fx := loadFixture(t, "emoji.json")
	res := post(t, context.Background(), srv.URL, fx.Match)
	defer res.Body.Close()
	var got strings.Builder
	for _, e := range readEvents(t, res.Body) {
		if e.Name == "response.output_text.delta" {
			got.WriteString(e.Data["delta"].(string))
		}
	}
	if !strings.Contains(got.String(), `\ud83d\ude00`) {
		t.Fatalf("surrogate escape missing: %s", got.String())
	}
	var a, b any
	if err := json.Unmarshal([]byte(got.String()), &a); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(fx.Result, &b); err != nil {
		t.Fatal(err)
	}
	am, _ := json.Marshal(a, json.Deterministic(true))
	bm, _ := json.Marshal(b, json.Deterministic(true))
	if string(am) != string(bm) {
		t.Fatal("decoded stream differs from fixture result")
	}
}

func TestErrorFixture(t *testing.T) {
	srv := httptest.NewServer(fakeopenai.Handler(fixturesDir))
	defer srv.Close()
	fx := loadFixture(t, "error-budget.json")
	res := post(t, context.Background(), srv.URL, fx.Match)
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	if res.StatusCode != 429 || !strings.Contains(string(b), "insufficient_quota") {
		t.Fatalf("status %d body %s", res.StatusCode, b)
	}
}

func TestDefaultFixtureAndStats(t *testing.T) {
	srv := httptest.NewServer(fakeopenai.Handler(fixturesDir))
	defer srv.Close()
	res := post(t, context.Background(), srv.URL, "no marker here")
	io.Copy(io.Discard, res.Body)
	res.Body.Close()
	st := stats(t, srv.URL)
	if st.Requests != 1 || len(st.LastBodies) != 1 || !strings.Contains(st.LastBodies[0], "no marker here") {
		t.Fatalf("stats %+v", st)
	}
	for range 6 {
		r := post(t, context.Background(), srv.URL, "x")
		io.Copy(io.Discard, r.Body)
		r.Body.Close()
	}
	if st := stats(t, srv.URL); len(st.LastBodies) != 5 || st.Requests != 7 {
		t.Fatalf("stats %+v", st)
	}
	r, _ := http.Post(srv.URL+"/_reset", "", nil)
	r.Body.Close()
	if st := stats(t, srv.URL); st.Requests != 0 || st.Aborted != 0 {
		t.Fatalf("after reset %+v", st)
	}
}

func stats(t *testing.T, url string) fakeopenai.Stats {
	t.Helper()
	res, err := http.Get(url + "/_stats")
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

// Active counts in-flight requests, survives /_reset, and drops only after
// the abort of a canceled stream has been counted.
func TestActiveTracksInFlightRequests(t *testing.T) {
	srv := httptest.NewServer(fakeopenai.Handler(fixturesDir))
	defer srv.Close()
	fx := loadFixture(t, "slow.json")

	ctx, cancel := context.WithCancel(context.Background())
	res := post(t, ctx, srv.URL, fx.Match)
	br := bufio.NewReader(res.Body)
	for {
		line, err := br.ReadString('\n')
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(line, "output_text.delta") {
			break
		}
	}
	if st := stats(t, srv.URL); st.Active != 1 {
		t.Fatalf("active = %d during stream, want 1", st.Active)
	}
	r, _ := http.Post(srv.URL+"/_reset", "", nil)
	r.Body.Close()
	if st := stats(t, srv.URL); st.Active != 1 || st.Requests != 0 {
		t.Fatalf("after reset %+v, want active 1 and requests 0", st)
	}

	cancel()
	res.Body.Close()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if st := stats(t, srv.URL); st.Active == 0 {
			if st.Aborted != 1 {
				t.Fatalf("active reached 0 before the abort was counted: %+v", st)
			}
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if st := stats(t, srv.URL); st.Active != 0 {
		t.Fatalf("active = %d after cancel, want 0", st.Active)
	}

	// Completed and error responses leave Active too.
	for _, m := range []string{"no marker here", loadFixture(t, "error-rate.json").Match} {
		r := post(t, context.Background(), srv.URL, m)
		io.Copy(io.Discard, r.Body)
		r.Body.Close()
	}
	if st := stats(t, srv.URL); st.Active != 0 {
		t.Fatalf("active = %d after finished requests, want 0", st.Active)
	}
}

func TestAbortCounted(t *testing.T) {
	srv := httptest.NewServer(fakeopenai.Handler(fixturesDir))
	defer srv.Close()
	fx := loadFixture(t, "slow.json")

	ctx, cancel := context.WithCancel(context.Background())
	res := post(t, ctx, srv.URL, fx.Match)
	br := bufio.NewReader(res.Body)
	for { // wait until at least one delta arrived
		line, err := br.ReadString('\n')
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(line, "output_text.delta") {
			break
		}
	}
	cancel()
	res.Body.Close()

	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if stats(t, srv.URL).Aborted == 1 {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("aborted = %d, want 1", stats(t, srv.URL).Aborted)
}

// Every fixture result must satisfy the strict shared schema its intent names.
func TestFixturesMatchSharedSchemas(t *testing.T) {
	c := jsonschema.NewCompiler()
	schemas := map[string]*jsonschema.Schema{}
	for _, intent := range []string{"sentence", "word"} {
		s, err := c.Compile("../../../shared/translation/schemas/" + intent + ".json")
		if err != nil {
			t.Fatal(err)
		}
		schemas[intent] = s
	}
	files, _ := filepath.Glob(filepath.Join(fixturesDir, "*.json"))
	if len(files) < 10 {
		t.Fatalf("expected the full fixture set, got %d", len(files))
	}
	for _, file := range files {
		raw, _ := os.ReadFile(file)
		var f fakeopenai.Fixture
		if err := json.Unmarshal(raw, &f); err != nil {
			t.Fatalf("%s: %v", file, err)
		}
		if f.Error != nil {
			if len(f.Result) != 0 && string(f.Result) != "null" {
				t.Errorf("%s: error fixture must not carry a result", file)
			}
			continue
		}
		s := schemas[f.Intent]
		if s == nil {
			t.Errorf("%s: unknown intent %q", file, f.Intent)
			continue
		}
		v, err := jsonschema.UnmarshalJSON(bytes.NewReader(f.Result))
		if err != nil {
			t.Errorf("%s: %v", file, err)
			continue
		}
		if err := s.Validate(v); err != nil {
			t.Errorf("%s: %v", file, err)
		}
	}
}

func TestFaultTruncateEndsWithoutCompleted(t *testing.T) {
	dir := t.TempDir()
	fx := `{"match":"[fx:cut]","delayMs":1,"chunk":5,"result":{"a":"hello world"},"fault":{"kind":"truncate","after":2}}`
	if err := os.WriteFile(filepath.Join(dir, "cut.json"), []byte(fx), 0o644); err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(fakeopenai.Handler(dir))
	defer srv.Close()
	res := post(t, context.Background(), srv.URL, "[fx:cut]")
	defer res.Body.Close()
	deltas := 0
	for _, e := range readEvents(t, res.Body) {
		switch e.Data["type"] {
		case "response.output_text.delta":
			deltas++
		case "response.completed":
			t.Fatal("truncated stream must not complete")
		}
	}
	if deltas != 2 {
		t.Fatalf("deltas = %d, want 2", deltas)
	}
}

// A "hang" fault stops after its deltas and holds the response open until
// the client leaves, which counts as an abort.
func TestFaultHangHoldsUntilAbort(t *testing.T) {
	dir := t.TempDir()
	fx := `{"match":"[fx:hang]","delayMs":1,"chunk":5,"result":{"a":"hello world"},"fault":{"kind":"hang","after":2}}`
	if err := os.WriteFile(filepath.Join(dir, "hang.json"), []byte(fx), 0o644); err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(fakeopenai.Handler(dir))
	defer srv.Close()
	ctx, cancel := context.WithCancel(context.Background())
	res := post(t, ctx, srv.URL, "[fx:hang]")
	br := bufio.NewReader(res.Body)
	deltas := 0
	for deltas < 2 {
		line, err := br.ReadString('\n')
		if err != nil {
			t.Fatal(err)
		}
		if strings.HasPrefix(line, "data: ") && strings.Contains(line, "output_text.delta") {
			deltas++
		}
	}
	if line, err := br.ReadString('\n'); err != nil || line != "\n" {
		t.Fatalf("event end = %q, %v", line, err)
	}
	more := make(chan string, 1)
	go func() {
		line, _ := br.ReadString('\n')
		more <- line
	}()
	select {
	case line := <-more:
		t.Fatalf("a hung stream sent %q", line)
	case <-time.After(300 * time.Millisecond):
	}
	if st := stats(t, srv.URL); st.Active != 1 || st.Aborted != 0 {
		t.Fatalf("while hung: %+v", st)
	}
	cancel()
	res.Body.Close()
	deadline := time.Now().Add(3 * time.Second)
	for st := stats(t, srv.URL); st.Aborted != 1 || st.Active != 0; st = stats(t, srv.URL) {
		if time.Now().After(deadline) {
			t.Fatalf("after the client left: %+v", st)
		}
		time.Sleep(20 * time.Millisecond)
	}
}
