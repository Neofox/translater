package translate

import (
	"encoding/json/v2"
	"io"
	"net/http"
	"regexp"
	"strings"
)

// Named SSE events. htmx 4's hx-sse extension dispatches each as a DOM event
// on the requesting form, with the raw JSON string in event.detail.data.
// Every payload carries the client's run id so the page can drop events of a
// superseded run.
const (
	evSourceLang = "nt-source-lang"
	evMainDelta  = "nt-main-delta"
	evMainReady  = "nt-main-ready"
	evTextDelta  = "nt-text-delta"
	evDone       = "nt-done"
	evError      = "nt-error"
)

// Payloads use explicit tags and no omitempty: a trimmed main may be "".
type (
	runPayload struct {
		Run string `json:"run"`
	}
	langPayload struct {
		Run  string `json:"run"`
		Lang string `json:"lang"`
	}
	textPayload struct {
		Run  string `json:"run"`
		Text string `json:"text"`
	}
	readyPayload struct {
		Run  string `json:"run"`
		Main string `json:"main"`
	}
	fieldTextPayload struct {
		Run   string `json:"run"`
		Field string `json:"field"`
		Text  string `json:"text"`
	}
	errorPayload struct {
		Run     string `json:"run"`
		Kind    string `json:"kind"`
		Message string `json:"message"`
	}
)

// sseWriter frames Server-Sent Events and flushes after each one. The first
// failed write or flush is sticky: every later call reports false, so the
// handler stops (and cancels upstream) once the client is gone.
type sseWriter struct {
	w     io.Writer
	flush func() error
	err   error
}

func newSSEWriter(w http.ResponseWriter) *sseWriter {
	rc := http.NewResponseController(w)
	return &sseWriter{w: w, flush: rc.Flush}
}

// event writes one named event with a JSON payload. JSON escapes CR and LF,
// so the payload is always a single data line.
func (s *sseWriter) event(name string, payload any) bool {
	data, err := json.Marshal(payload)
	if err != nil {
		s.err = err
		return false
	}
	return s.write("event: " + name + "\ndata: " + string(data) + "\n\n")
}

// lineBreak matches every SSE line terminator (hx-sse splits on all three).
var lineBreak = regexp.MustCompile(`\r\n|\r|\n`)

// partial writes one unnamed message carrying HTML (an <hx-partial>). Each
// line, including empty ones, becomes its own data line, so a raw CR or LF in
// model text can neither end the event nor start a new field.
func (s *sseWriter) partial(html string) bool {
	var b strings.Builder
	for _, line := range lineBreak.Split(html, -1) {
		b.WriteString("data: ")
		b.WriteString(line)
		b.WriteByte('\n')
	}
	b.WriteByte('\n')
	return s.write(b.String())
}

func (s *sseWriter) write(frame string) bool {
	if s.err != nil {
		return false
	}
	if _, err := io.WriteString(s.w, frame); err != nil {
		s.err = err
		return false
	}
	if err := s.flush(); err != nil {
		s.err = err
		return false
	}
	return true
}
