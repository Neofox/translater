package translate

import "testing"

// TestTargetLangEvent: the model-reported targetLang reaches the page as
// nt-target-lang when its value closes, right after nt-source-lang and before
// any main text, live and on a cache replay. The page uses it for the main
// text's lang, the register label and the Listen language (OutputPanel.tsx's
// live.partial.targetLang), falling back to the request target until then.
func TestTargetLangEvent(t *testing.T) {
	e := newEnv(t, fixturesDir, nil)
	for _, attempt := range []string{"live", "cached"} {
		evs := parseSSE(t, e.run(t, form("How are you [fx:target-lang]")))
		i := index(evs, evTargetLang)
		if i < 0 || index(evs, evSourceLang) != i-1 || index(evs, evMainDelta) < i {
			t.Fatalf("%s: want source-lang, target-lang, then main, got %v", attempt, names(evs))
		}
		if got := evs[i].json(t); got["run"] != "run-1" || got["lang"] != "fr" || len(got) != 2 {
			t.Errorf("%s: payload %v", attempt, got)
		}
	}
	if n := e.stats(t).Requests; n != 1 {
		t.Errorf("requests = %d, want 1 (the second run is a cache hit)", n)
	}
	word := parseSSE(t, e.run(t, form("[fx:word] thanks", "intent", "word")))
	if i := index(word, evTargetLang); i < 0 || word[i].json(t)["lang"] != "ko" {
		t.Errorf("word: no nt-target-lang ko in %v", names(word))
	}
}
