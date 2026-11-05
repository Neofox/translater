package web

import (
	"strings"
	"testing"

	"golang.org/x/net/html"
)

// AdjustMenu.tsx at rest: the collapsed trigger (a md Pill with its label
// and chevron; the icon-only SlidersHorizontal variant stays mounted hidden)
// and the closed group around RefineRow. adjust.js swaps the tone class and
// the icons as the measured width changes.
func TestAdjustMenuMarkup(t *testing.T) {
	doc := renderPage(t)
	tpl := find(doc, func(n *html.Node) bool { return n.Data == "template" && attrVal(n, "id") == "adjust-template" })
	if tpl == nil {
		t.Fatal("no #adjust-template")
	}
	menu := find(tpl, byClass("adjust-menu"))
	if menu == nil || hasAttr(menu, "data-inline") {
		t.Fatal("no collapsed .adjust-menu")
	}
	trigger := find(menu, byTestID("adjust-button"))
	if trigger == nil || trigger.Parent != menu {
		t.Fatal("adjust-button is not the menu's first control")
	}
	const pill = "ui-pill inline-flex shrink-0 cursor-pointer items-center justify-center whitespace-nowrap rounded-md border transition text-ink "
	const md = " gap-2 px-3 py-1.5 text-sm min-h-11 min-w-11 "
	if got, want := attrVal(trigger, "class"), pill+"border-border bg-panel hover:border-accent/60"+md+"adjust-trigger"; got != want {
		t.Errorf("trigger class\n got %q\nwant %q", got, want)
	}
	if got, want := attrVal(trigger, "data-active-class"), pill+"border-accent/70 bg-accent-soft [&>svg]:text-accent"+md+"adjust-trigger"; got != want {
		t.Errorf("trigger active class\n got %q\nwant %q", got, want)
	}
	for key, want := range map[string]string{"aria-expanded": "false", "aria-controls": "adjust-content", "aria-label": "Adjust"} {
		if got := attrVal(trigger, key); got != want {
			t.Errorf("trigger %s = %q, want %q", key, got, want)
		}
	}
	// The summary is part of the label, so prefs.js must not relabel it.
	if hasAttr(trigger, "data-t-attr") || hasAttr(trigger, "title") || hasAttr(trigger, "data-active") {
		t.Errorf("trigger attributes %v", trigger.Attr)
	}
	var kids []*html.Node
	for c := trigger.FirstChild; c != nil; c = c.NextSibling {
		if c.Type == html.ElementNode {
			kids = append(kids, c)
		}
	}
	if len(kids) != 3 {
		t.Fatalf("trigger children = %d, want sliders, label, chevron", len(kids))
	}
	if !strings.Contains(attrVal(kids[0], "class"), "lucide-sliders-horizontal") || attrVal(kids[0], "width") != "18" || !hasAttr(kids[0], "hidden") {
		t.Errorf("icon-only icon %v", kids[0].Attr)
	}
	if kids[1].Data != "span" || textOf(kids[1]) != "Adjust" || hasAttr(kids[1], "data-t") {
		t.Errorf("label %v %q", kids[1].Attr, textOf(kids[1]))
	}
	if attrVal(kids[2], "class") != "lucide lucide-chevron-down" || attrVal(kids[2], "width") != "14" || hasAttr(kids[2], "hidden") {
		t.Errorf("chevron %v", kids[2].Attr)
	}
	content := find(menu, byClass("adjust-content"))
	if content == nil || attrVal(content, "id") != "adjust-content" || attrVal(content, "role") != "group" ||
		attrVal(content, "aria-label") != "Adjust" || attrVal(content, "aria-hidden") != "true" || !hasAttr(content, "inert") ||
		hasAttr(content, "data-open") || hasAttr(content, "data-overlay") {
		t.Errorf("content %v", content)
	}
	if label := find(content, byClass("adjust-inline-label")); label == nil || textOf(label) != "Adjust" {
		t.Error("no in-line label")
	}
	if p := find(menu, byClass("adjust-error")); p == nil || attrVal(p, "role") != "alert" || !hasAttr(p, "hidden") {
		t.Error("collapsed notice")
	}
}
