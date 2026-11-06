package learning

import (
	"encoding/json/v2"
	"os"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/google/go-cmp/cmp"
	"github.com/google/go-cmp/cmp/cmpopts"
)

// corpusCase is one entry of testdata/corpus.json: frozen regression data,
// generated once from the original TypeScript implementation that Prepare
// replaced. Never regenerate it; add cases to ranges_test.go.
type corpusCase struct {
	Counterpart string      `json:"counterpart"`
	Primary     string      `json:"primary"`
	Phrases     []Phrase    `json:"phrases"`
	Want        *corpusWant `json:"want"`
}

type corpusWant struct {
	Partial bool          `json:"partial"`
	Chunks  []corpusChunk `json:"chunks"`
}

type corpusChunk struct {
	Start             int          `json:"start"`
	End               int          `json:"end"`
	Text              string       `json:"text"`
	GrammarHighlights []corpusSpan `json:"grammarHighlights"`
	SourceSpans       []corpusSpan `json:"sourceSpans"`
	Characters        []string     `json:"characters"`
}

type corpusSpan struct {
	Start int    `json:"start"`
	End   int    `json:"end"`
	Text  string `json:"text,omitempty"`
}

func loadCorpus(t testing.TB) []corpusCase {
	t.Helper()
	raw, err := os.ReadFile("testdata/corpus.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []corpusCase
	if err := json.Unmarshal(raw, &cases); err != nil {
		t.Fatal(err)
	}
	return cases
}

func toCorpus(p Prepared) *corpusWant {
	w := &corpusWant{Partial: p.Partial, Chunks: []corpusChunk{}}
	for _, c := range p.Chunks {
		tc := corpusChunk{Start: c.Start, End: c.End, Text: c.Text, GrammarHighlights: []corpusSpan{}, SourceSpans: []corpusSpan{}, Characters: []string{}}
		for _, h := range c.GrammarHighlights {
			tc.GrammarHighlights = append(tc.GrammarHighlights, corpusSpan{Start: h.Start, End: h.End})
		}
		for _, s := range c.SourceSpans {
			tc.SourceSpans = append(tc.SourceSpans, corpusSpan{s.Start, s.End, s.Text})
		}
		for _, n := range c.Characters {
			tc.Characters = append(tc.Characters, n.Word)
		}
		w.Chunks = append(w.Chunks, tc)
	}
	return w
}

// TestPrepareCorpus compares Prepare with the frozen corpus results: a
// seeded corpus of mixed scripts, emoji sequences, combining marks and
// grapheme-splitting quotes.
func TestPrepareCorpus(t *testing.T) {
	cases := loadCorpus(t)
	if len(cases) < 500 {
		t.Fatalf("corpus has %d cases", len(cases))
	}
	resolved := 0
	for i, c := range cases {
		var got *corpusWant
		if p, ok := Prepare(c.Counterpart, c.Primary, c.Phrases); ok {
			got = toCorpus(p)
			resolved++
		}
		if diff := cmp.Diff(c.Want, got, cmpopts.EquateEmpty()); diff != "" {
			t.Errorf("case %d (primary %q, counterpart %q) (-corpus +go):\n%s", i, c.Primary, c.Counterpart, diff)
		}
	}
	if resolved < 100 {
		t.Errorf("only %d corpus cases resolve; the corpus no longer exercises Prepare", resolved)
	}
}

// FuzzPrepare checks Prepare's invariants on arbitrary input: chunks are
// sorted, disjoint, exact quotations on grapheme boundaries, and every
// highlight lies inside its chunk. Seeded with the corpus.
func FuzzPrepare(f *testing.F) {
	for _, c := range loadCorpus(f) {
		for _, p := range c.Phrases {
			hl := strings.Join(p.GrammarHighlights, "\x00")
			src := strings.Join(p.SourceTexts, "\x00")
			f.Add(c.Counterpart, c.Primary, p.Text, hl, src)
		}
	}
	f.Fuzz(func(t *testing.T, counterpart, primary, phrase, highlights, sources string) {
		// Inputs are JSON strings and browser form values: valid UTF-8.
		for _, s := range []string{counterpart, primary, phrase, highlights, sources} {
			if !utf8.ValidString(s) {
				return
			}
		}
		phrases := []Phrase{{Text: phrase, Grammar: "g", GrammarHighlights: strings.Split(highlights, "\x00"), SourceTexts: strings.Split(sources, "\x00")}}
		for _, part := range strings.Fields(phrase) {
			phrases = append(phrases, Phrase{Text: part})
		}
		got, ok := Prepare(counterpart, primary, phrases)
		if !ok {
			return
		}
		text, other := encode(primary), encode(counterpart)
		edges, otherEdges := boundaries(primary), boundaries(counterpart)
		cursor := 0
		for _, c := range got.Chunks {
			if c.Start < cursor || c.Start >= c.End || !edges[c.Start] || !edges[c.End] || decode(text[c.Start:c.End]) != c.Text {
				t.Fatalf("bad chunk %+v in %q", c.Range, primary)
			}
			cursor = c.End
			hcur := c.Start
			for _, h := range c.GrammarHighlights {
				if h.Start < hcur || h.Start >= h.End || h.End > c.End || !edges[h.Start] || !edges[h.End] {
					t.Fatalf("bad highlight %+v in chunk %+v", h, c.Range)
				}
				hcur = h.End
			}
			for _, s := range c.SourceSpans {
				if s.End > len(other) || !otherEdges[s.Start] || !otherEdges[s.End] || decode(other[s.Start:s.End]) != s.Text {
					t.Fatalf("bad source span %+v in %q", s, counterpart)
				}
			}
		}
	})
}
