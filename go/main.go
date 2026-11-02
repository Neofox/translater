// Spike server: proves incremental SSE (GET and POST), request cancellation
// propagation and instance reuse on Vercel's Go runtime, plus the htmx 4
// streaming protocol. Throwaway: later tasks replace this entry point.
package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"sync/atomic"
	"time"
)

var (
	instance     = randomID()
	bootAt       = time.Now().UnixMilli()
	served       atomic.Int64
	lastCancelAt atomic.Int64
)

func randomID() string {
	b := make([]byte, 6)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func intParam(r *http.Request, name string, def int) int {
	if v, err := strconv.Atoi(r.URL.Query().Get(name)); err == nil && v > 0 {
		return v
	}
	return def
}

func sseHeaders(w http.ResponseWriter) http.Flusher {
	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-cache, no-transform")
	h.Set("X-Accel-Buffering", "no")
	h.Set("X-Instance", instance)
	f, _ := w.(http.Flusher)
	w.WriteHeader(http.StatusOK)
	if f != nil {
		f.Flush()
	}
	return f
}

func stream(w http.ResponseWriter, r *http.Request) {
	served.Add(1)
	n, ms := intParam(r, "n", 50), intParam(r, "ms", 100)
	f := sseHeaders(w)
	tick := time.NewTicker(time.Duration(ms) * time.Millisecond)
	defer tick.Stop()
	for i := 0; i < n; i++ {
		select {
		case <-r.Context().Done():
			lastCancelAt.Store(time.Now().UnixMilli())
			return
		case <-tick.C:
		}
		fmt.Fprintf(w, "data: %d %d\n\n", i, time.Now().UnixMilli())
		if f != nil {
			f.Flush()
		}
	}
}

func stats(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"instance":     instance,
		"served":       served.Load(),
		"lastCancelAt": lastCancelAt.Load(),
		"now":          time.Now().UnixMilli(),
		"bootAt":       bootAt,
	})
}

const page = `<!doctype html>
<html><head><meta charset="utf-8"><title>spike</title>
<script src="/static/vendor/htmx.min.js"></script>
%s</head><body>
<form id="f" hx-post="/spike/htmx" hx-trigger="submit" hx-sync="this:replace" hx-swap="none">
  <textarea name="q">hi</textarea><button id="go" type="submit">go</button>
</form>
<div id="a">A0</div><div id="b">B0</div>
<script>
window.spikeEvents = [];
for (const name of ['nt-main-delta', 'nt-main-ready']) {
  document.addEventListener(name, e => window.spikeEvents.push({name, t: Date.now(), target: e.target.id || e.target.tagName, detail: e.detail}));
}
window.spikeSwaps = [];
new MutationObserver(() => window.spikeSwaps.push({t: Date.now(), a: document.getElementById('a').textContent, b: document.getElementById('b').textContent}))
  .observe(document.body, {subtree: true, childList: true, characterData: true});
</script>
</body></html>`

// spikePage serves the page; ?noext=1 omits the hx-sse extension (negative
// control: proves the extension is what parses text/event-stream).
func spikePage(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "private, no-store")
	ext := `<script src="/static/vendor/hx-sse.min.js"></script>` + "\n"
	if r.URL.Query().Get("noext") == "1" {
		ext = ""
	}
	fmt.Fprintf(w, page, ext)
}

// htmxStream: two unnamed <hx-partial> messages 300ms apart, then two named
// events carrying JSON. Holds the stream open afterwards (hold ms, default
// 5000) so abort/replace can be observed server-side via ctx.Done().
func htmxStream(w http.ResponseWriter, r *http.Request) {
	served.Add(1)
	f := sseHeaders(w)
	send := func(s string, pause time.Duration) bool {
		fmt.Fprint(w, s)
		if f != nil {
			f.Flush()
		}
		select {
		case <-r.Context().Done():
			lastCancelAt.Store(time.Now().UnixMilli())
			return false
		case <-time.After(pause):
			return true
		}
	}
	const gap = 300 * time.Millisecond
	_ = send("data: <hx-partial hx-target=\"#a\" hx-swap=\"innerHTML\">A1</hx-partial>\n\n", gap) &&
		send("data: <hx-partial hx-target=\"#b\" hx-swap=\"innerHTML\">B1</hx-partial>\n\n", gap) &&
		send("event: nt-main-delta\ndata: {\"text\":\"안녕\"}\n\n", gap) &&
		send("event: nt-main-ready\ndata: {\"main\":\"안녕하세요\"}\n\n", time.Duration(intParam(r, "hold", 5000))*time.Millisecond)
}

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /spike/stream", stream)
	mux.HandleFunc("POST /spike/stream", stream)
	mux.HandleFunc("GET /spike/stats", stats)
	mux.HandleFunc("GET /spike/page", spikePage)
	mux.HandleFunc("POST /spike/htmx", htmxStream)
	mux.Handle("GET /static/", http.StripPrefix("/static/", http.FileServer(http.Dir("web/static"))))
	port := os.Getenv("PORT")
	if port == "" {
		port = "3000"
	}
	log.Printf("spike instance %s on :%s", instance, port)
	log.Fatal(http.ListenAndServe(":"+port, mux))
}
