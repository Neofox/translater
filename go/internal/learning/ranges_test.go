package learning

import (
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/google/go-cmp/cmp"
	"github.com/google/go-cmp/cmp/cmpopts"
)

// Ports of the src/lib/learningRanges.test.ts cases that call
// prepareLearningResult, under the same names.

const (
	thanksSource = "Thanks for helping me today."
	thanksTarget = "오늘 도와줘서 고마워요."
)

// withFact fills the shared learner facts of the TS `fact` fixture.
func withFact(p Phrase) Phrase {
	p.Gloss = or(p.Gloss, "for helping me")
	p.BaseForm = "도와주다"
	p.LiteralMeaning = "because you helped"
	p.NaturalMeaning = "for helping me"
	p.Grammar = "-어서 gives the reason"
	p.Omissions = "you and me are implicit"
	return p
}

func or(s, fallback string) string {
	if s != "" {
		return s
	}
	return fallback
}

func note(word string, chars ...string) CharacterNote {
	return CharacterNote{Word: word, Chars: notes(chars...)}
}

func mustPrepare(t *testing.T, counterpart, primary string, phrases []Phrase) Prepared {
	t.Helper()
	got, ok := Prepare(counterpart, primary, phrases)
	if !ok {
		t.Fatal("Prepare returned no result")
	}
	return got
}

func texts(p Prepared) []string {
	out := make([]string, len(p.Chunks))
	for i, c := range p.Chunks {
		out[i] = c.Text
	}
	return out
}

func TestPrepare(t *testing.T) {
	t.Run("retains complete phrase details and resolves only quoted grammar highlights", func(t *testing.T) {
		got := mustPrepare(t, thanksSource, thanksTarget, []Phrase{
			withFact(Phrase{Text: "오늘", Gloss: "today", SourceTexts: []string{"today"}, GrammarHighlights: []string{}}),
			withFact(Phrase{Text: "도와줘서", SourceTexts: []string{"for helping me"}, GrammarHighlights: []string{"줘서", "missing"}}),
			withFact(Phrase{Text: "고마워요", Gloss: "thanks", SourceTexts: []string{"Thanks"}, GrammarHighlights: []string{"요"}}),
		})
		c := got.Chunks[1]
		if c.Gloss != "for helping me" || c.BaseForm != "도와주다" || c.LiteralMeaning != "because you helped" ||
			c.NaturalMeaning != "for helping me" || c.Grammar != "-어서 gives the reason" || c.Omissions != "you and me are implicit" {
			t.Errorf("chunk 1 facts = %+v", c)
		}
		if diff := cmp.Diff([]Range{{5, 7}}, c.GrammarHighlights); diff != "" {
			t.Errorf("chunk 1 highlights (-want +got):\n%s", diff)
		}
		if len(got.Chunks[0].GrammarHighlights) != 0 {
			t.Errorf("chunk 0 highlights = %v, want none", got.Chunks[0].GrammarHighlights)
		}
		if diff := cmp.Diff([]Range{{11, 12}}, got.Chunks[2].GrammarHighlights); diff != "" {
			t.Errorf("chunk 2 highlights (-want +got):\n%s", diff)
		}
	})

	t.Run("drops character notes that are not real hanja, kanji or hanzi for their word", func(t *testing.T) {
		got := mustPrepare(t, "I am sorry, call me after lunch.", "미안해, 점심 후에 전화해.", []Phrase{
			withFact(Phrase{Text: "미안해", Characters: []CharacterNote{
				note("미안", "未", "安"),
				// Hangul syllables are not hanja.
				note("미안해", "미", "안", "해"),
			}}),
			withFact(Phrase{Text: "점심 후에 전화해", Characters: []CharacterNote{
				note("점심", "點", "心"),
				// One hanja per Hangul syllable, never more or fewer.
				note("전화", "電"),
				note("후", "後", "後"),
			}}),
		})
		var words [][]string
		for _, c := range got.Chunks {
			var w []string
			for _, n := range c.Characters {
				w = append(w, n.Word)
			}
			words = append(words, w)
		}
		if diff := cmp.Diff([][]string{{"미안"}, {"점심"}}, words); diff != "" {
			t.Errorf("character words (-want +got):\n%s", diff)
		}
		// Japanese words keep their kana; only the kanji are listed.
		japanese := mustPrepare(t, "Nostalgic.", "懐かしい。", []Phrase{
			withFact(Phrase{Text: "懐かしい", Characters: []CharacterNote{note("懐かしい", "懐")}}),
		})
		if n := len(japanese.Chunks[0].Characters); n != 1 {
			t.Errorf("japanese characters = %d, want 1", n)
		}
	})

	t.Run("does not underline ambiguous quotes or split a combining-character grapheme", func(t *testing.T) {
		got := mustPrepare(t, "", "banana é", []Phrase{
			withFact(Phrase{Text: "banana é", GrammarHighlights: []string{"a", "e"}}),
		})
		if h := got.Chunks[0].GrammarHighlights; len(h) != 0 {
			t.Errorf("highlights = %v, want none", h)
		}
	})

	t.Run("requires a grammar explanation before an annotation can be underlined", func(t *testing.T) {
		p := withFact(Phrase{Text: "오늘", SourceTexts: []string{"today"}, GrammarHighlights: []string{"오늘"}})
		p.Grammar = ""
		got := mustPrepare(t, "today", "오늘", []Phrase{p})
		if h := got.Chunks[0].GrammarHighlights; len(h) != 0 {
			t.Errorf("highlights = %v, want none", h)
		}
		// Whitespace-only grammar counts as absent (TS `grammar.trim()`).
		p.Grammar = " \n"
		if h := mustPrepare(t, "today", "오늘", []Phrase{p}).Chunks[0].GrammarHighlights; len(h) != 0 {
			t.Errorf("blank grammar highlights = %v, want none", h)
		}
	})

	t.Run("prepares exact phrase positions and meanings from the translation response without model-counted offsets", func(t *testing.T) {
		got := mustPrepare(t, thanksSource, thanksTarget, []Phrase{
			{Text: "오늘", Gloss: "today", SourceTexts: []string{"today"}},
			{Text: ",", SourceTexts: []string{}},
			{Text: "도와줘서", Gloss: "for helping me", SourceTexts: []string{"for helping me"}},
			{Text: "고마워요", Gloss: "thanks", SourceTexts: []string{"Thanks"}},
		})
		if diff := cmp.Diff([]string{"오늘", "도와줘서", "고마워요"}, texts(got)); diff != "" {
			t.Errorf("texts (-want +got):\n%s", diff)
		}
		c := got.Chunks[1]
		if c.Range != (Range{3, 7}) || c.Gloss != "for helping me" {
			t.Errorf("chunk 1 = %+v", c)
		}
		if diff := cmp.Diff([]SourceSpan{{Range{7, 21}, "for helping me"}}, c.SourceSpans); diff != "" {
			t.Errorf("chunk 1 source spans (-want +got):\n%s", diff)
		}
	})

	t.Run("uses phrase order to resolve repeated quotes and leaves an ambiguous lone quote unmarked", func(t *testing.T) {
		phrase := Phrase{Text: "yes", Gloss: "agreement", SourceTexts: []string{}}
		got := mustPrepare(t, "oui oui", "yes yes", []Phrase{phrase, phrase})
		var starts []int
		for _, c := range got.Chunks {
			starts = append(starts, c.Start)
		}
		if diff := cmp.Diff([]int{0, 4}, starts); diff != "" {
			t.Errorf("starts (-want +got):\n%s", diff)
		}
		if _, ok := Prepare("oui oui", "yes yes", []Phrase{phrase}); ok {
			t.Error("a lone repeated quote resolved, want no result")
		}
	})

	t.Run("keeps independent Korean details when model quotations overlap", func(t *testing.T) {
		korean := "평면도 작성 기능을 확인해 보실 수 있는 링크를 공유드립니다.\n직접 사용해 보시고, UX 흐름이나 사용성에 관한 의견이 있으시면 편하게 알려 주세요."
		got := mustPrepare(t, "An English translation.", korean, []Phrase{
			withFact(Phrase{Text: "평면도 작성 기능을"}),
			withFact(Phrase{Text: "작성 기능을 확인해 보실 수 있는"}),
			withFact(Phrase{Text: "링크를 공유드립니다"}),
			withFact(Phrase{Text: "직접 사용해 보시고"}),
		})
		if diff := cmp.Diff([]string{"링크를 공유드립니다", "직접 사용해 보시고"}, texts(got)); diff != "" {
			t.Errorf("texts (-want +got):\n%s", diff)
		}
		if !got.Partial {
			t.Error("Partial = false, want true")
		}
	})

	t.Run("orders uniquely quoted details without inventing positions for ambiguous repeats", func(t *testing.T) {
		got := mustPrepare(t, "", "one yes yes two", []Phrase{
			withFact(Phrase{Text: "two"}),
			withFact(Phrase{Text: "one"}),
			withFact(Phrase{Text: "yes"}),
		})
		type pos struct {
			Text       string
			Start, End int
		}
		var gotPos []pos
		for _, c := range got.Chunks {
			gotPos = append(gotPos, pos{c.Text, c.Start, c.End})
		}
		if diff := cmp.Diff([]pos{{"one", 0, 3}, {"two", 12, 15}}, gotPos); diff != "" {
			t.Errorf("positions (-want +got):\n%s", diff)
		}
		if !got.Partial {
			t.Error("Partial = false, want true")
		}
	})
}

// TestPrepareOffsetsAreUTF16: offsets are what the textarea and JS slicing
// use (UTF-16 code units), not Go byte or rune offsets. The brief quoted
// Range{8,11} for this literal; that value fits a bare 👍 with a precomposed
// é. With the skin-tone modifier (2 astral code points, 4 units) and the
// combining é (2 units), 좋아요 starts at unit 11.
func TestPrepareOffsetsAreUTF16(t *testing.T) {
	primary := "👍🏽 café 좋아요"
	got := mustPrepare(t, "", primary, []Phrase{{
		Text: "좋아요", Grammar: "polite present", GrammarHighlights: []string{"좋아요"},
	}})
	want := Range{11, 14}
	if got.Chunks[0].Range != want {
		t.Errorf("chunk range = %+v, want %+v", got.Chunks[0].Range, want)
	}
	if diff := cmp.Diff([]Range{want}, got.Chunks[0].GrammarHighlights); diff != "" {
		t.Errorf("highlights (-want +got):\n%s", diff)
	}
	byteStart := strings.Index(primary, "좋아요")
	runeStart := utf8.RuneCountInString(primary[:byteStart])
	if byteStart == want.Start || runeStart == want.Start {
		t.Errorf("UTF-16 start %d must differ from byte %d and rune %d offsets", want.Start, byteStart, runeStart)
	}
	if !got.Partial {
		t.Error("Partial = false, want true (emoji and café are uncovered)")
	}
}

// TestPrepareSourceSide: reading Korean with an English UI analyses the
// Korean source (primary) and quotes the English translation (counterpart).
func TestPrepareSourceSide(t *testing.T) {
	if side := Side("ko", "en", "en"); side != "source" {
		t.Fatalf("Side = %q, want source", side)
	}
	got := mustPrepare(t, thanksSource, thanksTarget, []Phrase{
		withFact(Phrase{Text: "오늘", Gloss: "today", SourceTexts: []string{"today"}}),
		withFact(Phrase{Text: "도와줘서", SourceTexts: []string{"for helping me"}, GrammarHighlights: []string{"줘서"}}),
		withFact(Phrase{Text: "고마워요", Gloss: "thanks", SourceTexts: []string{"Thanks", "missing"}}),
	})
	type shape struct {
		Range
		SourceSpans       []SourceSpan
		GrammarHighlights []Range
	}
	want := []shape{
		{Range{0, 2}, []SourceSpan{{Range{22, 27}, "today"}}, nil},
		{Range{3, 7}, []SourceSpan{{Range{7, 21}, "for helping me"}}, []Range{{5, 7}}},
		{Range{8, 12}, []SourceSpan{{Range{0, 6}, "Thanks"}}, nil},
	}
	var gotShapes []shape
	for _, c := range got.Chunks {
		gotShapes = append(gotShapes, shape{c.Range, c.SourceSpans, c.GrammarHighlights})
	}
	if diff := cmp.Diff(want, gotShapes, cmpopts.EquateEmpty()); diff != "" {
		t.Errorf("chunks (-want +got):\n%s", diff)
	}
	if got.Partial {
		t.Error("Partial = true, want false (only the final period is uncovered)")
	}
}

func TestPrepareRejects(t *testing.T) {
	for _, tc := range []struct {
		name    string
		primary string
		phrases []Phrase
	}{
		{"no phrases", "text", nil},
		{"punctuation-only phrases", "a, b.", []Phrase{{Text: ","}, {Text: "."}}},
		{"quotes absent from the primary text", "hello", []Phrase{{Text: "bye"}}},
		{"a quote that splits a grapheme", "café", []Phrase{{Text: "cafe"}}},
		{"only overlapping quotes", "abc", []Phrase{{Text: "ab"}, {Text: "bc"}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got, ok := Prepare("", tc.primary, tc.phrases); ok {
				t.Errorf("Prepare = %+v, want no result", got)
			}
		})
	}
}

func TestPrepareSourceSpansAreUniqueAndOnBoundaries(t *testing.T) {
	got := mustPrepare(t, "yes yes 👍🏽 é", "word", []Phrase{{
		Text:        "word",
		SourceTexts: []string{"yes", "👍", "e", "👍🏽", "é"},
	}})
	want := []SourceSpan{{Range{8, 12}, "👍🏽"}, {Range{13, 15}, "é"}}
	if diff := cmp.Diff(want, got.Chunks[0].SourceSpans); diff != "" {
		t.Errorf("source spans (-want +got):\n%s", diff)
	}
}

func TestPrepareGrammarHighlightsKeepNonOverlappingPrefix(t *testing.T) {
	// Sorted by start asc, end desc: "abc" wins over its prefix "ab", "bcd"
	// overlaps it and is dropped, "e" survives.
	got := mustPrepare(t, "", "abcde", []Phrase{{
		Text: "abcde", Grammar: "g", GrammarHighlights: []string{"ab", "e", "bcd", "abc", "."},
	}})
	if diff := cmp.Diff([]Range{{0, 3}, {4, 5}}, got.Chunks[0].GrammarHighlights); diff != "" {
		t.Errorf("highlights (-want +got):\n%s", diff)
	}
}
