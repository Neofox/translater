package web

import (
	"context"
	"os"
	"strings"
	"testing"

	"golang.org/x/net/html"

	"neotranslate/internal/contract"
	"neotranslate/internal/learning"
)

func TestCharacterLabelKey(t *testing.T) {
	for word, want := range map[string]string{
		"":     "characters",
		"학교":   "hanja",
		"勉強する": "kanji",
		"学校":   "hanzi",
		"abc":  "characters",
		// Hangul wins over kana, kana over Han (the TS check order).
		"学校학": "hanja",
		"学す":  "kanji",
	} {
		if got := CharacterLabelKey(word); got != want {
			t.Errorf("CharacterLabelKey(%q) = %q, want %q", word, got, want)
		}
	}
}

func renderMeta(t *testing.T, v WordMetaView) *html.Node {
	t.Helper()
	c, err := contract.Load()
	if err != nil {
		t.Fatal(err)
	}
	v.T = func(key string) string { return c.T("en", key) }
	var b strings.Builder
	if err := WordMeta(v).Render(context.Background(), &b); err != nil {
		t.Fatal(err)
	}
	doc, err := html.Parse(strings.NewReader("<body>" + b.String()))
	if err != nil {
		t.Fatal(err)
	}
	return doc
}

// visibleText is the text outside [hidden] subtrees.
func visibleText(n *html.Node) string {
	var b strings.Builder
	var walk func(*html.Node)
	walk = func(n *html.Node) {
		if n.Type == html.ElementNode && hasAttr(n, "hidden") {
			return
		}
		if n.Type == html.TextNode {
			b.WriteString(n.Data)
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(n)
	return b.String()
}

func TestWordMetaEmptyAfterStreamingRendersNothing(t *testing.T) {
	doc := renderMeta(t, WordMetaView{})
	if find(doc, byClass("word-source-meta")) != nil {
		t.Fatal("an empty finished entry renders the meta block")
	}
	doc = renderMeta(t, WordMetaView{Streaming: true})
	meta := find(doc, byClass("word-source-meta"))
	if meta == nil || !strings.Contains(visibleText(meta), "Primary meaning") || find(meta, byClass("animate-pulse")) == nil {
		t.Fatal("a streaming empty entry shows the Primary meaning skeleton")
	}
}

func TestWordMetaCharacterNotes(t *testing.T) {
	doc := renderMeta(t, WordMetaView{Characters: []learning.CharacterNote{
		{Word: "사랑", Chars: []learning.CharNote{{Char: "思", Meaning: "think"}}},
		{Word: "학교", Chars: []learning.CharNote{{Char: "學", Meaning: "learn"}, {Char: "校", Meaning: "school"}}},
	}})
	notes := find(doc, byClass("character-notes"))
	if notes == nil {
		t.Fatal("no character notes")
	}
	text := visibleText(notes)
	if !strings.HasPrefix(text, "hanja") || !strings.Contains(text, "학교 學 (learn) · 校 (school)") || strings.Contains(text, "사랑") {
		t.Fatalf("character notes = %q", text)
	}
	// Only invalid notes: the block is ready but renders nothing.
	doc = renderMeta(t, WordMetaView{Characters: []learning.CharacterNote{
		{Word: "사랑", Chars: []learning.CharNote{{Char: "思", Meaning: "think"}}},
	}, Etymology: "e"})
	if find(doc, byClass("character-notes")) != nil {
		t.Fatal("invalid notes rendered")
	}
}

func TestPosTabClassesMatchDictionaryJS(t *testing.T) {
	js, err := os.ReadFile("../../web/static/js/dictionary.js")
	if err != nil {
		t.Fatal(err)
	}
	for _, class := range []string{posTabOn, posTabOff} {
		if !strings.Contains(string(js), "'"+class+"'") {
			t.Errorf("dictionary.js lacks %q", class)
		}
	}
}

func TestWordMetaPOSVariants(t *testing.T) {
	pos := []POSView{
		{Pos: "interjection", Senses: []SenseView{{Definition: "first"}, {Definition: "second", Examples: []string{"ex"}}}},
		{Pos: "noun", Senses: []SenseView{{Definition: "gratitude"}}},
	}
	doc := renderMeta(t, WordMetaView{POS: pos})
	meta := find(doc, byClass("word-source-meta"))
	tabs := elementChildren(elementChildren(meta)[0])
	if len(tabs) != 2 || attrVal(tabs[0], "class") != posTabOn || attrVal(tabs[1], "class") != posTabOff {
		t.Fatalf("tabs = %d", len(tabs))
	}
	if got := visibleText(meta); !strings.Contains(got, "first") || !strings.Contains(got, "2.second") ||
		!strings.Contains(got, "(noun)gratitude") || strings.Contains(got, "(interjection)") {
		t.Fatalf("active variant 0 text = %q", got)
	}
	// The second variant is mounted hidden for dictionary.js.
	var hidden int
	for _, c := range elementChildren(meta) {
		if attrVal(c, "data-pos") == "1" && hasAttr(c, "hidden") {
			hidden++
		}
	}
	if hidden != 3 {
		t.Fatalf("hidden variant-1 blocks = %d, want 3 (label, primary, other)", hidden)
	}
}
