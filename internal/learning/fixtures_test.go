package learning

import (
	"encoding/json/v2"
	"os"
	"path/filepath"
	"testing"

	"github.com/google/go-cmp/cmp"
	"github.com/google/go-cmp/cmp/cmpopts"
)

const fixturesDir = "../../e2e/fixtures/results"

// TestLearningFixtures pins what the e2e learning fixtures resolve to with
// the source text the browser tests type: the fixture marker and a nonce
// appended (helpers `sentence()` style) or the marker prepended
// (`visualText()` style). Source-side fixtures quote the typed text, so it
// must contain each quotation exactly once.
func TestLearningFixtures(t *testing.T) {
	type chunk struct {
		Text       string
		Highlights []string // quoted grammar highlights, as text
		Spans      []string // counterpart quotations, as text
		Characters []string // character-note words
	}
	for _, tc := range []struct {
		fixture string
		uiLang  string
		side    string
		sources []string // the typed source texts
		chunks  []chunk
	}{
		{
			fixture: "learn-reading", uiLang: "en", side: "source",
			sources: []string{"오늘 도와줘서 고마워요. [fx:learn-reading] n12345678", "[fx:learn-reading] 오늘 도와줘서 고마워요."},
			chunks: []chunk{
				{"오늘", nil, []string{"today"}, nil},
				{"도와줘서", []string{"줘서"}, []string{"for helping me"}, nil},
				{"고마워요", []string{"고마워요"}, []string{"Thanks"}, nil},
			},
		},
		{
			fixture: "learn-reading-ko", uiLang: "ko", side: "source",
			sources: []string{"How are you doing today my friend [fx:learn-reading-ko] n12345678", "[fx:learn-reading-ko] How are you doing today, my friend?"},
			chunks: []chunk{
				{"How are you doing", []string{"are you doing"}, []string{"어떻게 지내요"}, nil},
				{"today", nil, []string{"오늘"}, nil},
				{"my friend", []string{"my"}, []string{"친구"}, nil},
			},
		},
		{
			fixture: "learn-overlap", uiLang: "en", side: "source",
			sources: []string{
				"평면도 작성 기능을 확인해 보실 수 있는 링크를 공유드립니다.\n직접 사용해 보시고, UX 흐름이나 사용성에 관한 의견이 있으시면 편하게 알려 주세요. [fx:learn-overlap] n12345678",
				"[fx:learn-overlap] 평면도 작성 기능을 확인해 보실 수 있는 링크를 공유드립니다.\n직접 사용해 보시고, UX 흐름이나 사용성에 관한 의견이 있으시면 편하게 알려 주세요.",
			},
			// The first two quotations overlap and are both dropped.
			chunks: []chunk{
				{"링크를 공유드립니다", []string{"드립니다"}, []string{"Here is a link"}, []string{"공유"}},
				{"직접 사용해 보시고", []string{"보시고"}, []string{"try it yourself"}, nil},
			},
		},
		{
			fixture: "learn-unicode", uiLang: "en", side: "source",
			sources: []string{"👍🏽 정말 고마워요! 👨‍👩‍👧 가족이랑 같이 봤어요. [fx:learn-unicode] n12345678", "[fx:learn-unicode] 👍🏽 정말 고마워요! 👨‍👩‍👧 가족이랑 같이 봤어요."},
			chunks: []chunk{
				{"정말 고마워요", []string{"고마워요"}, []string{"Thank you so much"}, nil},
				{"가족이랑 같이 봤어요", []string{"이랑", "봤어요"}, []string{"I watched it with my family"}, []string{"가족"}},
			},
		},
		{
			// Target side: the repeated 네 resolves by phrase order; the lone
			// 좋아요 quote is ambiguous (it occurs twice) and stays unmarked.
			fixture: "learn-repeat", uiLang: "en", side: "target",
			sources: []string{"Yes, yes. Sounds good, sounds good! [fx:learn-repeat] n12345678"},
			chunks: []chunk{
				{"네", nil, []string{"Yes"}, nil},
				{"네", nil, []string{"yes"}, nil},
			},
		},
	} {
		t.Run(tc.fixture, func(t *testing.T) {
			raw, err := os.ReadFile(filepath.Join(fixturesDir, tc.fixture+".json"))
			if err != nil {
				t.Fatal(err)
			}
			var fx struct {
				Result struct {
					SourceLang      string   `json:"sourceLang"`
					TargetLang      string   `json:"targetLang"`
					Main            string   `json:"main"`
					LearningPhrases []Phrase `json:"learningPhrases"`
				} `json:"result"`
			}
			if err := json.Unmarshal(raw, &fx); err != nil {
				t.Fatal(err)
			}
			r := fx.Result
			side := Side(r.SourceLang, r.TargetLang, tc.uiLang)
			if side != tc.side {
				t.Fatalf("Side = %q, want %q", side, tc.side)
			}
			for _, source := range tc.sources {
				primary, counterpart := r.Main, source
				if side == "source" {
					primary, counterpart = source, r.Main
				}
				got, ok := Prepare(counterpart, primary, r.LearningPhrases)
				if !ok {
					t.Fatalf("%q: no result", source)
				}
				p, c := encode(primary), encode(counterpart)
				var chunks []chunk
				for _, ch := range got.Chunks {
					x := chunk{Text: decode(p[ch.Start:ch.End])}
					for _, h := range ch.GrammarHighlights {
						x.Highlights = append(x.Highlights, decode(p[h.Start:h.End]))
					}
					for _, s := range ch.SourceSpans {
						x.Spans = append(x.Spans, decode(c[s.Start:s.End]))
					}
					for _, n := range ch.Characters {
						x.Characters = append(x.Characters, n.Word)
					}
					chunks = append(chunks, x)
				}
				if diff := cmp.Diff(tc.chunks, chunks, cmpopts.EquateEmpty()); diff != "" {
					t.Errorf("%q chunks (-want +got):\n%s", source, diff)
				}
				// The marker, nonce or an ambiguous repeat is always uncovered.
				if !got.Partial {
					t.Errorf("%q: Partial = false, want true", source)
				}
			}
		})
	}
}

// TestLearnUnicodeOffsets: with the marker appended, the learn-unicode
// underlines sit after a skin-tone emoji and a ZWJ family sequence, where
// UTF-16, rune and byte offsets all differ.
func TestLearnUnicodeOffsets(t *testing.T) {
	primary := "👍🏽 정말 고마워요! 👨‍👩‍👧 가족이랑 같이 봤어요. [fx:learn-unicode] n12345678"
	got := mustPrepare(t, "", primary, []Phrase{
		{Text: "정말 고마워요", Grammar: "g", GrammarHighlights: []string{"고마워요"}},
		{Text: "가족이랑 같이 봤어요", Grammar: "g", GrammarHighlights: []string{"이랑", "봤어요"}},
	})
	if diff := cmp.Diff([]Range{{5, 12}, {23, 34}}, []Range{got.Chunks[0].Range, got.Chunks[1].Range}); diff != "" {
		t.Errorf("chunks (-want +got):\n%s", diff)
	}
	if diff := cmp.Diff([]Range{{25, 27}, {31, 34}}, got.Chunks[1].GrammarHighlights); diff != "" {
		t.Errorf("highlights (-want +got):\n%s", diff)
	}
}
