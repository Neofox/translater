package translate

import (
	"slices"
	"testing"
)

// A cached word result replays the same #word-meta partials without an
// upstream request (TestWordMetaStreamsSections checks their content).
func TestWordMetaReplayedFromCache(t *testing.T) {
	e := newEnv(t, fixturesDir, nil)
	live := wordMetaPartials(parseSSE(t, e.run(t, form("[fx:word] thanks", "intent", "word"))))
	cached := wordMetaPartials(parseSSE(t, e.run(t, form("[fx:word] thanks", "intent", "word", "run", "run-2"))))
	if st := e.stats(t); st.Requests != 1 {
		t.Fatalf("upstream requests = %d, want 1 (second run must hit the cache)", st.Requests)
	}
	if len(live) == 0 || !slices.Equal(live, cached) {
		t.Fatalf("cached #word-meta partials differ: %d live, %d cached", len(live), len(cached))
	}
}
