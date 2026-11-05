package translate

import (
	"encoding/json/jsontext"
	"encoding/json/v2"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync/atomic"
	"testing"
)

type learningEvent struct {
	Run      string `json:"run"`
	Side     string `json:"side"`
	Language string `json:"language"`
	Chunks   []struct {
		S   int      `json:"s"`
		E   int      `json:"e"`
		Src [][2]int `json:"src"`
		G   [][2]int `json:"g"`
	} `json:"chunks"`
	Partial bool `json:"partial"`
}

const learningPartial = `<hx-partial hx-target="#learning-sentence" hx-swap="innerHTML">`

func learningOf(t *testing.T, evs []sseEvent) (learningEvent, int) {
	t.Helper()
	i := index(evs, evLearning)
	if i < 0 {
		t.Fatalf("no %s event: %v", evLearning, names(evs))
	}
	var l learningEvent
	if err := json.Unmarshal([]byte(evs[i].Data), &l); err != nil {
		t.Fatal(err)
	}
	return l, i
}

func spans(l learningEvent) [][2]int {
	var out [][2]int
	for _, c := range l.Chunks {
		out = append(out, [2]int{c.S, c.E})
	}
	return out
}

// The ranges of a sentence's learning phrases (UTF-16, ranges only) and
// their rows arrive just before nt-done, after the rows partial, live and
// from the cache.
func TestLearningEmittedBeforeDone(t *testing.T) {
	e := newEnv(t, fixturesDir, nil)
	for _, run := range []string{"run-1", "run-2"} {
		evs := parseSSE(t, e.run(t, form("How are you doing today?", "run", run)))
		l, i := learningOf(t, evs)
		if done := index(evs, evDone); done != i+1 || done != len(evs)-1 {
			t.Fatalf("%s: learning at %d, done at %d of %d", run, i, done, len(evs))
		}
		if p := evs[i-1]; p.Name != "" || !strings.HasPrefix(p.Data, learningPartial) ||
			!strings.Contains(p.Data, `aria-controls="lp-`+run+`-1"`) || !strings.Contains(p.Data, `data-testid="learning-chunk"`) {
			t.Fatalf("%s: the rows partial does not precede nt-learning: %q", run, p.Data)
		}
		if l.Run != run || l.Side != "target" || l.Language != "ko" || l.Partial {
			t.Errorf("%s: payload %+v", run, l)
		}
		// main "오늘 어떻게 지내요?", source "How are you doing today?"
		if len(l.Chunks) != 2 ||
			!slices.Equal(spans(l), [][2]int{{0, 2}, {3, 10}}) ||
			!slices.Equal(l.Chunks[0].Src, [][2]int{{18, 23}}) || len(l.Chunks[0].G) != 0 ||
			!slices.Equal(l.Chunks[1].Src, [][2]int{{0, 17}}) || !slices.Equal(l.Chunks[1].G, [][2]int{{7, 10}}) {
			t.Errorf("%s: chunks %+v", run, l.Chunks)
		}
		if strings.Contains(evs[i].Data, "오늘") || strings.Contains(evs[i].Data, "today") {
			t.Errorf("%s: nt-learning carries text: %s", run, evs[i].Data)
		}
	}
	if st := e.stats(t); st.Requests != 1 {
		t.Errorf("upstream requests = %d, want 1", st.Requests)
	}
}

// Prepare runs while the rest of the result streams: it starts when
// learningPhrases completes, before the first rationale delta is written.
func TestLearningPrepareStartsBeforeRationale(t *testing.T) {
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
	var started atomic.Int32
	atRationale := int32(-1)
	w := writerFunc(func(b []byte) {
		if atRationale < 0 && strings.Contains(string(b), `"field":"rationale"`) {
			atRationale = started.Load()
		}
	})
	p := newTestProcessor(t, w, "sentence")
	p.raw = "How are you doing today?"
	p.onPrepare = func() { started.Add(1) }
	doc := []rune(string(f.Result))
	for i := 0; i < len(doc); i += 12 {
		if err := p.feed(string(doc[i:min(i+12, len(doc))])); err != nil {
			t.Fatal(err)
		}
	}
	if atRationale != 1 {
		t.Fatalf("Prepare starts before the first rationale delta: count %d there", atRationale)
	}
	if !p.end() || started.Load() != 1 {
		t.Fatalf("end failed or Prepare ran %d times", started.Load())
	}
}

type writerFunc func([]byte)

func (w writerFunc) Write(b []byte) (int, error) { w(b); return len(b), nil }

// Ranges depend on the exact textarea value, not the trimmed prompt text:
// a cache hit for the same trimmed text recomputes them.
func TestCacheHitRecomputesWithRawText(t *testing.T) {
	e := newEnv(t, fixturesDir, nil)
	text := "오늘 도와줘서 고마워요. [fx:learn-reading]"
	langs := []string{"source", "ko", "target", "en"}
	first, _ := learningOf(t, parseSSE(t, e.run(t, form(text, langs...))))
	second, _ := learningOf(t, parseSSE(t, e.run(t, form("  "+text+" \n", append(langs, "run", "run-2")...))))
	if st := e.stats(t); st.Requests != 1 {
		t.Fatalf("upstream requests = %d, want 1 (same trimmed text)", st.Requests)
	}
	if first.Side != "source" || !slices.Equal(spans(first), [][2]int{{0, 2}, {3, 7}, {8, 12}}) {
		t.Fatalf("first run: %+v", first)
	}
	want := [][2]int{{2, 4}, {5, 9}, {10, 14}}
	if got := spans(second); !slices.Equal(got, want) {
		t.Errorf("ranges on the raw text = %v, want %v", got, want)
	}
	if !slices.Equal(second.Chunks[1].G, [][2]int{{7, 9}}) {
		t.Errorf("grammar ranges = %v", second.Chunks[1].G)
	}
}

// Form encoding may turn the textarea's LF into CRLF; ranges (and the
// prompt) use textarea.value's LF.
func TestLearningNormalizesCRLF(t *testing.T) {
	e := newEnv(t, fixturesDir, nil)
	lines := []string{
		"평면도 작성 기능을 확인해 보실 수 있는 링크를 공유드립니다.",
		"직접 사용해 보시고, UX 흐름이나 사용성에 관한 의견이 있으시면 편하게 알려 주세요. [fx:learn-overlap]",
	}
	langs := []string{"source", "ko", "target", "en"}
	lf, _ := learningOf(t, parseSSE(t, e.run(t, form(strings.Join(lines, "\n"), langs...))))
	crlf, _ := learningOf(t, parseSSE(t, e.run(t, form(strings.Join(lines, "\r\n"), append(langs, "run", "run-2")...))))
	if st := e.stats(t); st.Requests != 1 {
		t.Errorf("upstream requests = %d, want 1 (CRLF is the same prompt text and cache key)", st.Requests)
	}
	second := utf16Len(lines[0]) + 1
	if len(lf.Chunks) != 2 || lf.Chunks[1].S != second {
		t.Fatalf("LF chunks %v, want the second at %d", spans(lf), second)
	}
	if !slices.Equal(spans(crlf), spans(lf)) || !slices.Equal(crlf.Chunks[1].G, lf.Chunks[1].G) {
		t.Errorf("CRLF ranges %v, LF ranges %v", spans(crlf), spans(lf))
	}
}

func utf16Len(s string) int {
	n := 0
	for _, r := range s {
		if r >= 0x10000 {
			n += 2
		} else {
			n++
		}
	}
	return n
}

// No learning without resolvable phrases, and never for a word.
func TestNoLearningWithoutPhrases(t *testing.T) {
	e := newEnv(t, fixturesDir, nil)
	for _, v := range [][]string{
		{"[fx:visual] How are you doing today, my friend?"},
		{"[fx:word] thanks", "intent", "word"},
	} {
		evs := parseSSE(t, e.run(t, form(v[0], v[1:]...)))
		if index(evs, evLearning) >= 0 || slices.ContainsFunc(partials(evs), func(p string) bool {
			return strings.HasPrefix(p, learningPartial)
		}) {
			t.Errorf("%q: unexpected learning", v[0])
		}
		if evs[len(evs)-1].Name != evDone {
			t.Errorf("%q: last event %q", v[0], evs[len(evs)-1].Name)
		}
	}
}
