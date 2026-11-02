// Package fakeopenai is a fake OpenAI Responses API server for tests: it
// replays canned fixtures as a streamed `POST /v1/responses`, so browser and
// unit tests (TypeScript app and Go app alike) never make paid calls.
//
// Hand-written because no maintained library fakes the Responses streaming
// protocol; the SSE writer is stdlib. Event shapes follow the OpenAI
// Responses streaming reference (sequence_number, item_id, output_index and
// content_index on every output-text event) so openai-go and the AI SDK both
// accept the stream.
package fakeopenai

import (
	"cmp"
	"context"
	"encoding/json/jsontext"
	"encoding/json/v2"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"
	"unicode/utf16"
)

const (
	defaultChunk   = 12
	defaultDelayMs = 20
	maxBodies      = 5
	defaultFixture = "default.json"
	itemID         = "msg_fake0001"
	respID         = "resp_fake0001"
)

// Fixture is one canned reply. Match is a substring looked for in the last
// user text part of the request; default.json answers everything else. A
// non-nil Error replaces the stream with an HTTP error response.
type Fixture struct {
	Match   string         `json:"match"`
	Intent  string         `json:"intent"`
	Chunk   int            `json:"chunk"`
	DelayMs *int           `json:"delayMs"`
	ASCII   bool           `json:"ascii"` // escape every non-ASCII rune as \uXXXX (surrogate pairs)
	Result  jsontext.Value `json:"result"`
	Error   *FixtureError  `json:"error"`
}

// FixtureError is the HTTP status and JSON body returned instead of a stream.
type FixtureError struct {
	Status int            `json:"status"`
	Body   jsontext.Value `json:"body"`
}

// Stats is the body of GET /_stats. Active counts requests still being
// served; it is live state, so /_reset keeps it. A request leaves Active only
// after any abort it caused has been counted, so a caller that waits for
// Active == 0 before /_reset cannot have a late abort leak past the reset.
type Stats struct {
	Requests   int      `json:"requests"`
	Aborted    int      `json:"aborted"`
	Active     int      `json:"active"`
	LastBodies []string `json:"lastBodies"`
}

type server struct {
	dir string
	mu  sync.Mutex
	st  Stats
}

// Handler serves the fake API, reading fixtures from fixturesDir on every
// request so edits show up without a restart.
func Handler(fixturesDir string) http.Handler {
	s := &server{dir: fixturesDir, st: Stats{LastBodies: []string{}}}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /v1/responses", s.responses)
	mux.HandleFunc("GET /_stats", s.stats)
	mux.HandleFunc("POST /_reset", s.reset)
	return mux
}

func (s *server) stats(w http.ResponseWriter, _ *http.Request) {
	s.mu.Lock()
	out, _ := json.Marshal(s.st)
	s.mu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	w.Write(out)
}

func (s *server) reset(w http.ResponseWriter, _ *http.Request) {
	s.mu.Lock()
	s.st = Stats{Active: s.st.Active, LastBodies: []string{}}
	s.mu.Unlock()
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) countAbort() {
	s.mu.Lock()
	s.st.Aborted++
	s.mu.Unlock()
}

type requestBody struct {
	Model string `json:"model"`
	Input []struct {
		Role    string         `json:"role"`
		Content jsontext.Value `json:"content"`
	} `json:"input"`
}

// lastUserText returns the last non-empty text part of the last user message.
func lastUserText(b requestBody) string {
	for _, m := range slices.Backward(b.Input) {
		if m.Role != "user" {
			continue
		}
		var text string
		if json.Unmarshal(m.Content, &text) == nil {
			return text
		}
		var parts []struct {
			Text string `json:"text"`
		}
		if json.Unmarshal(m.Content, &parts) == nil {
			for _, p := range slices.Backward(parts) {
				if p.Text != "" {
					return p.Text
				}
			}
		}
		return ""
	}
	return ""
}

func (s *server) loadFixtures() (matched []Fixture, def *Fixture, err error) {
	entries, err := os.ReadDir(s.dir)
	if err != nil {
		return nil, nil, err
	}
	for _, e := range entries { // ReadDir is sorted, so matching is deterministic
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		raw, err := os.ReadFile(filepath.Join(s.dir, e.Name()))
		if err != nil {
			return nil, nil, err
		}
		var f Fixture
		if err := json.Unmarshal(raw, &f); err != nil {
			return nil, nil, fmt.Errorf("%s: %w", e.Name(), err)
		}
		if e.Name() == defaultFixture {
			def = &f
		} else if f.Match != "" {
			matched = append(matched, f)
		}
	}
	return matched, def, nil
}

func (s *server) responses(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	s.st.Active++
	s.mu.Unlock()
	// Deferred first, so it runs last: after the stream counted any abort.
	defer func() {
		s.mu.Lock()
		s.st.Active--
		s.mu.Unlock()
	}()
	raw, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "read body", http.StatusBadRequest)
		return
	}
	s.mu.Lock()
	s.st.Requests++
	s.st.LastBodies = append(s.st.LastBodies, string(raw))
	if n := len(s.st.LastBodies); n > maxBodies {
		s.st.LastBodies = slices.Clone(s.st.LastBodies[n-maxBodies:])
	}
	s.mu.Unlock()

	var body requestBody
	if err := json.Unmarshal(raw, &body); err != nil {
		writeError(w, http.StatusBadRequest, nil)
		return
	}
	text := lastUserText(body)
	matched, def, err := s.loadFixtures()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	fx := def
	for i := range matched {
		if strings.Contains(text, matched[i].Match) {
			fx = &matched[i]
			break
		}
	}
	if fx == nil {
		http.Error(w, "no matching fixture and no default.json", http.StatusInternalServerError)
		return
	}
	if fx.Error != nil {
		writeError(w, cmp.Or(fx.Error.Status, http.StatusInternalServerError), fx.Error.Body)
		return
	}
	s.stream(r.Context(), w, fx, body.Model)
}

func writeError(w http.ResponseWriter, status int, body jsontext.Value) {
	if len(body) == 0 {
		body = jsontext.Value(`{"error":{"message":"bad request","type":"invalid_request_error","code":null,"param":null}}`)
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	w.Write(body)
}

// serialize renders the fixture result as the model would stream it: compact
// JSON in fixture key order, HTML characters escaped as < etc., and
// optionally every non-ASCII rune as \uXXXX.
func serialize(f *Fixture) (string, error) {
	out, err := json.Marshal(f.Result, jsontext.EscapeForHTML(true))
	if err != nil {
		return "", err
	}
	if !f.ASCII {
		return string(out), nil
	}
	var b strings.Builder
	for _, r := range string(out) {
		if r < 0x80 {
			b.WriteRune(r)
			continue
		}
		for _, u := range utf16.Encode([]rune{r}) {
			fmt.Fprintf(&b, `\u%04x`, u)
		}
	}
	return b.String(), nil
}

// splitRunes cuts s every n runes, never inside a UTF-8 sequence.
func splitRunes(s string, n int) []string {
	rs := []rune(s)
	var out []string
	for len(rs) > 0 {
		k := min(n, len(rs))
		out = append(out, string(rs[:k]))
		rs = rs[k:]
	}
	return out
}

func (s *server) stream(ctx context.Context, w http.ResponseWriter, fx *Fixture, model string) {
	full, err := serialize(fx)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	chunks := splitRunes(full, cmp.Or(fx.Chunk, defaultChunk))
	delay := defaultDelayMs * time.Millisecond
	if fx.DelayMs != nil {
		delay = time.Duration(*fx.DelayMs) * time.Millisecond
	}
	model = cmp.Or(model, "fake-model")

	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-cache")
	rc := http.NewResponseController(w)
	seq := 0
	send := func(typ string, fields map[string]any) error {
		fields["type"] = typ
		fields["sequence_number"] = seq
		seq++
		data, err := json.Marshal(fields)
		if err != nil {
			return err
		}
		if _, err := fmt.Fprintf(w, "event: %s\ndata: %s\n\n", typ, data); err != nil {
			return err
		}
		return rc.Flush()
	}
	response := func(status string, output []any, usage any) map[string]any {
		return map[string]any{
			"id": respID, "object": "response", "created_at": 1700000000,
			"status": status, "model": model, "output": output, "usage": usage,
			"error": nil, "incomplete_details": nil, "store": false,
			"service_tier": "default", "parallel_tool_calls": false, "tools": []any{},
			"tool_choice": "auto", "temperature": 1, "top_p": 1, "metadata": map[string]any{},
		}
	}
	part := func(text string) map[string]any {
		return map[string]any{"type": "output_text", "text": text, "annotations": []any{}, "logprobs": []any{}}
	}
	item := func(status string, content ...any) map[string]any {
		if content == nil {
			content = []any{}
		}
		return map[string]any{"id": itemID, "type": "message", "status": status, "role": "assistant", "content": content}
	}
	at := func(extra map[string]any) map[string]any {
		m := map[string]any{"item_id": itemID, "output_index": 0, "content_index": 0}
		for k, v := range extra {
			m[k] = v
		}
		return m
	}

	if send("response.created", map[string]any{"response": response("in_progress", []any{}, nil)}) != nil ||
		send("response.in_progress", map[string]any{"response": response("in_progress", []any{}, nil)}) != nil ||
		send("response.output_item.added", map[string]any{"output_index": 0, "item": item("in_progress")}) != nil ||
		send("response.content_part.added", at(map[string]any{"part": part("")})) != nil {
		s.countAbort()
		return
	}
	for _, c := range chunks {
		select {
		case <-ctx.Done():
			s.countAbort()
			return
		case <-time.After(delay):
		}
		if send("response.output_text.delta", at(map[string]any{"delta": c, "logprobs": []any{}})) != nil {
			s.countAbort()
			return
		}
	}
	// Token counts are synthetic; only their presence and shape matter.
	usage := map[string]any{
		"input_tokens": 1200, "input_tokens_details": map[string]any{"cached_tokens": 1024},
		"output_tokens": len(chunks) * 3, "output_tokens_details": map[string]any{"reasoning_tokens": 0},
		"total_tokens": 1200 + len(chunks)*3,
	}
	done := response("completed", []any{item("completed", part(full))}, usage)
	done["service_tier"] = "priority"
	if send("response.output_text.done", at(map[string]any{"text": full, "logprobs": []any{}})) != nil ||
		send("response.content_part.done", at(map[string]any{"part": part(full)})) != nil ||
		send("response.output_item.done", map[string]any{"output_index": 0, "item": item("completed", part(full))}) != nil ||
		send("response.completed", map[string]any{"response": done}) != nil {
		s.countAbort()
	}
}
