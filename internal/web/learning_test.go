package web

import (
	"context"
	"slices"
	"strings"
	"testing"

	"golang.org/x/net/html"

	"neotranslate/internal/contract"
	"neotranslate/internal/learning"
)

func renderRows(t *testing.T, v LearningRowsView) *html.Node {
	t.Helper()
	c, err := contract.Load()
	if err != nil {
		t.Fatal(err)
	}
	v.T = func(key string) string { return c.T("en", key) }
	var b strings.Builder
	if err := LearningRows(v).Render(context.Background(), &b); err != nil {
		t.Fatal(err)
	}
	doc, err := html.Parse(strings.NewReader("<body>" + b.String()))
	if err != nil {
		t.Fatal(err)
	}
	return find(doc, func(n *html.Node) bool { return n.Data == "body" })
}

func findAll(n *html.Node, ok func(*html.Node) bool) []*html.Node {
	var out []*html.Node
	var walk func(*html.Node)
	walk = func(n *html.Node) {
		if n.Type == html.ElementNode && ok(n) {
			out = append(out, n)
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(n)
	return out
}

// LearningRows renders the whole-sentence phrase list:
// one row button per chunk (text → gloss), facts in display order with only
// non-blank values, character notes, and the partial-coverage status.
// Every row's details wait hidden; punctuation-only chunks get no row but
// keep the indices of the others.
func TestLearningRows(t *testing.T) {
	body := renderRows(t, LearningRowsView{
		Run:      "r1",
		Language: "ko",
		Partial:  true,
		Chunks: []learning.Chunk{
			{Range: learning.Range{Start: 0, End: 2}, Text: "오늘", Gloss: "today", BaseForm: " \u00a0", Grammar: "\ufeff"},
			{Range: learning.Range{Start: 2, End: 3}, Text: "…"},
			{
				Range: learning.Range{Start: 3, End: 9}, Text: "공유드립니다", NaturalMeaning: "share", BaseForm: "공유드리다",
				LiteralMeaning: "humbly share", Grammar: "드립니다 is humble.", UsageNote: "Workplace.", Omissions: "I is implicit.",
				Characters: []learning.CharacterNote{{Word: "공유", Chars: []learning.CharNote{{Char: "共", Meaning: "together"}, {Char: "有", Meaning: "have"}}}},
			},
		},
	})
	kids := elementChildren(body)
	if len(kids) != 2 || kids[0].Data != "ul" || attrVal(kids[0], "class") != "learning-chunks" ||
		kids[1].Data != "p" || attrVal(kids[1], "class") != "learning-status" || textOf(kids[1]) != "Some text has no phrase breakdown." {
		t.Fatalf("section content: %d children", len(kids))
	}
	rows := elementChildren(kids[0])
	if len(rows) != 2 {
		t.Fatalf("%d rows, want 2 (punctuation-only chunk omitted)", len(rows))
	}
	for i, want := range []struct{ label, id, text, gloss string }{
		{"오늘 today", "lp-r1-0", "오늘", "today"},
		{"공유드립니다 share", "lp-r1-2", "공유드립니다", "share"},
	} {
		parts := elementChildren(rows[i])
		if len(parts) != 2 {
			t.Fatalf("row %d: %d children", i, len(parts))
		}
		button, detail := parts[0], parts[1]
		if button.Data != "button" || attrVal(button, "type") != "button" || attrVal(button, "aria-label") != want.label ||
			attrVal(button, "aria-expanded") != "false" || attrVal(button, "aria-controls") != want.id ||
			attrVal(button, "data-testid") != "learning-chunk" {
			t.Errorf("row %d button: %v", i, button.Attr)
		}
		spans := elementChildren(button)
		if textOf(button) != want.text+"→"+want.gloss { // no whitespace between the spans
			t.Errorf("row %d button text %q", i, textOf(button))
		}
		if len(spans) != 3 || attrVal(spans[0], "lang") != "ko" || hasAttr(spans[0], "class") || textOf(spans[0]) != want.text ||
			attrVal(spans[1], "aria-hidden") != "true" || textOf(spans[1]) != "→" || textOf(spans[2]) != want.gloss {
			t.Errorf("row %d spans: %q", i, textOf(button))
		}
		if detail.Data != "div" || attrVal(detail, "id") != want.id || attrVal(detail, "class") != "phrase-detail" ||
			attrVal(detail, "role") != "region" || attrVal(detail, "aria-label") != want.text || !hasAttr(detail, "hidden") {
			t.Errorf("row %d details: %v", i, detail.Attr)
		}
	}
	dt := func(row *html.Node) []string {
		var out []string
		for _, n := range findAll(row, func(n *html.Node) bool { return n.Data == "dt" }) {
			out = append(out, textOf(n))
		}
		return out
	}
	// JS trim: NBSP and BOM are blank, so only the gloss shows.
	if got := dt(rows[0]); !slices.Equal(got, []string{"In this sentence"}) {
		t.Errorf("row 0 facts %q", got)
	}
	want := []string{"Base form", "Literal", "Natural", "Grammar", "Notes", "Left out"}
	if got := dt(rows[1]); !slices.Equal(got, want) {
		t.Errorf("row 1 facts %q, want %q", got, want)
	}
	for _, dd := range findAll(rows[1], func(n *html.Node) bool { return n.Data == "dd" }) {
		if lang := attrVal(dd, "lang"); (textOf(dd) == "공유드리다") != (lang == "ko") || hasAttr(dd, "lang") && lang != "ko" {
			t.Errorf("dd %q lang %q (only baseForm carries the analysed language)", textOf(dd), lang)
		}
	}
	notes := find(rows[1], byClass("character-notes"))
	if notes == nil || !strings.Contains(textOf(notes), "共 (together) · 有 (have)") {
		t.Error("row 1 lacks its character notes")
	}
	if find(rows[0], byClass("character-notes")) != nil {
		t.Error("row 0 has character notes")
	}
}

func TestLearningRowsComplete(t *testing.T) {
	body := renderRows(t, LearningRowsView{Run: "r", Language: "en", Chunks: []learning.Chunk{{Text: "Thanks", Gloss: "고마워요"}}})
	if find(body, byClass("learning-status")) != nil {
		t.Error("complete coverage shows the partial status")
	}
}

// The reference pane holds both learning sections: the sentence
// one before the word one, hidden until learning.js shows a breakdown.
func TestReferencePaneSections(t *testing.T) {
	doc := renderPage(t)
	inspector := find(doc, byTestID("learning-inspector"))
	kids := elementChildren(inspector)
	if len(kids) != 2 || attrVal(kids[0], "id") != "learning-sentence" || attrVal(kids[1], "id") != "word-meta" {
		t.Fatalf("inspector children: %d", len(kids))
	}
	if kids[0].Data != "section" || attrVal(kids[0], "aria-label") != "Whole sentence" || !hasAttr(kids[0], "hidden") {
		t.Errorf("sentence section: %v", kids[0].Attr)
	}
}
