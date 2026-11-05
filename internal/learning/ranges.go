package learning

import (
	"cmp"
	"slices"
	"strings"
)

// Range is a half-open span in UTF-16 code units.
type Range struct{ Start, End int }

// SourceSpan is a counterpart quotation of a phrase and where it is.
type SourceSpan struct {
	Range
	Text string
}

// Phrase is one generated `learningPhrases` item of the sentence result.
type Phrase struct {
	Text              string          `json:"text"`
	Gloss             string          `json:"gloss"`
	SourceTexts       []string        `json:"sourceTexts"`
	BaseForm          string          `json:"baseForm"`
	LiteralMeaning    string          `json:"literalMeaning"`
	NaturalMeaning    string          `json:"naturalMeaning"`
	Grammar           string          `json:"grammar"`
	Omissions         string          `json:"omissions"`
	GrammarHighlights []string        `json:"grammarHighlights"`
	UsageNote         string          `json:"usageNote"`
	Characters        []CharacterNote `json:"characters"`
}

// Chunk is a phrase resolved to its place in the primary text.
type Chunk struct {
	Range
	Text, Gloss, BaseForm, LiteralMeaning, NaturalMeaning, Grammar, Omissions, UsageNote string
	// Characters keeps only real hanja/kanji/hanzi origins of words in Text.
	Characters []CharacterNote
	// GrammarHighlights are sorted, disjoint ranges in the primary text.
	GrammarHighlights []Range
	// SourceSpans are ranges in the counterpart text.
	SourceSpans []SourceSpan
}

// Prepared is the learning result of one translation.
type Prepared struct {
	Chunks []Chunk // in primary-text order, disjoint
	// Partial: some letter, number or symbol of the primary text is in no chunk.
	Partial bool
}

// Prepare resolves phrases quoted from primary (the analysed text) and their
// counterpart quotations (sourceTexts) in counterpart. It reports false when
// no phrase resolves.
//
// It is hand-written because no library resolves model quotations into
// grapheme-safe, order-disambiguated ranges; graphemes come from
// rivo/uniseg. The model never counts offsets: every range is found from an
// exact quotation, and ambiguous or invalid quotations stay unmarked.
func Prepare(counterpart, primary string, phrases []Phrase) (Prepared, bool) {
	var kept []Phrase
	for _, p := range phrases {
		if IsLearningText(p.Text) && strings.Contains(primary, p.Text) {
			kept = append(kept, p)
		}
	}
	if len(kept) == 0 {
		return Prepared{}, false
	}
	text, other := encode(primary), encode(counterpart)
	edges, otherEdges := boundaries(primary), boundaries(counterpart)
	var chunks []Chunk
	for _, span := range phraseRanges(text, kept, edges) {
		p := kept[span.index]
		quote := encode(p.Text)
		chunk := Chunk{
			Range: Range{span.start, span.end},
			Text:  p.Text, Gloss: p.Gloss, BaseForm: p.BaseForm,
			LiteralMeaning: p.LiteralMeaning, NaturalMeaning: p.NaturalMeaning,
			Grammar: p.Grammar, Omissions: p.Omissions, UsageNote: p.UsageNote,
			Characters:        []CharacterNote{},
			GrammarHighlights: []Range{},
			SourceSpans:       []SourceSpan{},
		}
		for _, n := range p.Characters {
			if strings.Contains(p.Text, n.Word) && IsCharacterOrigin(n.Word, n.Chars) {
				chunk.Characters = append(chunk.Characters, n)
			}
		}
		if strings.TrimSpace(p.Grammar) != "" {
			chunk.GrammarHighlights = grammarRanges(quote, span.start, p.GrammarHighlights, edges)
		}
		for _, s := range p.SourceTexts {
			q := encode(s)
			from := indexOf(other, q, 0)
			to := from + len(q)
			if from >= 0 && from == lastIndexOf(other, q, len(other)) && otherEdges[from] && otherEdges[to] {
				chunk.SourceSpans = append(chunk.SourceSpans, SourceSpan{Range{from, to}, s})
			}
		}
		chunks = append(chunks, chunk)
	}
	if len(chunks) == 0 {
		return Prepared{}, false
	}
	var uncovered []uint16
	cursor := 0
	for _, c := range chunks {
		uncovered = append(uncovered, text[cursor:c.Start]...)
		cursor = c.End
	}
	uncovered = append(uncovered, text[cursor:]...)
	return Prepared{Chunks: chunks, Partial: IsLearningText(decode(uncovered))}, true
}

type phraseSpan struct{ index, start, end int }

// phraseRanges preserves ordered repeat disambiguation, and salvages only
// unique, disjoint quotes when a malformed ordering or an overlap makes the
// full sequence impossible.
func phraseRanges(text []uint16, phrases []Phrase, edges map[int]bool) []phraseSpan {
	quotes := make([][]uint16, len(phrases))
	for i, p := range phrases {
		quotes[i] = encode(p.Text)
	}
	// Earliest and latest placement of the whole sequence in order: a phrase
	// whose two placements agree has only one position.
	earliest := make([]int, len(quotes))
	latest := make([]int, len(quotes))
	ordered := true
	cursor := 0
	for i, q := range quotes {
		start := indexOf(text, q, cursor)
		if start < 0 {
			ordered = false
			break
		}
		earliest[i] = start
		cursor = start + len(q)
	}
	if ordered {
		cursor = len(text)
		for i := len(quotes) - 1; i >= 0; i-- {
			start := lastIndexOf(text, quotes[i], cursor-len(quotes[i]))
			if start < 0 {
				ordered = false
				break
			}
			latest[i] = start
			cursor = start
		}
	}
	var candidates []phraseSpan
	for i, q := range quotes {
		start, last := indexOf(text, q, 0), lastIndexOf(text, q, len(text))
		if ordered {
			start, last = earliest[i], latest[i]
		}
		end := start + len(q)
		if start >= 0 && start == last && edges[start] && edges[end] {
			candidates = append(candidates, phraseSpan{i, start, end})
		}
	}
	slices.SortStableFunc(candidates, func(a, b phraseSpan) int {
		return cmp.Or(cmp.Compare(a.start, b.start), cmp.Compare(a.end, b.end))
	})
	// Reject both members of an overlap instead of choosing one arbitrarily.
	var out []phraseSpan
	for i, span := range candidates {
		overlaps := false
		for j, other := range candidates {
			if i != j && span.start < other.end && other.start < span.end {
				overlaps = true
				break
			}
		}
		if !overlaps {
			out = append(out, span)
		}
	}
	return out
}

// grammarRanges resolves grammar quotations that occur exactly once inside
// the phrase (quote, at offset start of the primary text) on grapheme
// boundaries, then keeps the non-overlapping prefix sorted by start
// ascending and end descending.
func grammarRanges(quote []uint16, start int, highlights []string, edges map[int]bool) []Range {
	var spans []Range
	for _, h := range highlights {
		q := encode(h)
		from := indexOf(quote, q, 0)
		to := from + len(q)
		if IsLearningText(h) && from >= 0 && from == lastIndexOf(quote, q, len(quote)) &&
			edges[start+from] && edges[start+to] {
			spans = append(spans, Range{start + from, start + to})
		}
	}
	slices.SortStableFunc(spans, func(a, b Range) int {
		return cmp.Or(cmp.Compare(a.Start, b.Start), cmp.Compare(b.End, a.End))
	})
	out := []Range{}
	for _, s := range spans {
		if len(out) == 0 || s.Start >= out[len(out)-1].End {
			out = append(out, s)
		}
	}
	return out
}
