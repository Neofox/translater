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

// A word run reports its headword once, before the main text (schema
// order), live and from the cache; a sentence run never does. The page
// names the reference heading after it (ReferencePanel.tsx).
func TestWordHeadwordEvent(t *testing.T) {
	e := newEnv(t, fixturesDir, nil)
	for _, run := range []string{"run-1", "run-2"} {
		evs := parseSSE(t, e.run(t, form("[fx:word] thanks", "intent", "word", "run", run)))
		i := index(evs, evHeadword)
		if i < 0 || i > index(evs, evMainDelta) {
			t.Fatalf("%s: headword at %d, main delta at %d", run, i, index(evs, evMainDelta))
		}
		if got := evs[i].json(t); got["text"] != "thanks" || got["run"] != run {
			t.Errorf("%s: headword payload %v", run, got)
		}
		n := 0
		for _, ev := range evs {
			if ev.Name == evHeadword {
				n++
			}
		}
		if n != 1 {
			t.Errorf("%s: %d headword events", run, n)
		}
	}
	if st := e.stats(t); st.Requests != 1 {
		t.Errorf("upstream requests = %d, want 1 (second run from the cache)", st.Requests)
	}
	if evs := parseSSE(t, e.run(t, form("How are you doing today?"))); index(evs, evHeadword) >= 0 {
		t.Error("sentence run sent a headword")
	}
}
