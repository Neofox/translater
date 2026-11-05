package web

import (
	"strings"

	"testing"

	"golang.org/x/net/html"
)

// The refine row at rest inside the Adjust menu: the page renders it once
// in a <template> (refine.js inserts the menu for a sentence result), with
// every control disabled until a current result completes.
func TestRefineRowMarkup(t *testing.T) {
	doc := renderPage(t)
	tpl := find(doc, func(n *html.Node) bool { return n.Data == "template" && attrVal(n, "id") == "adjust-template" })
	if tpl == nil {
		t.Fatal("no #adjust-template")
	}
	if p := tpl.Parent; !hasClass(p, "app-settings") {
		t.Errorf("template parent = %s", nodePath(p))
	}
	// html.Parse puts template content under the template element itself.
	menu := find(tpl, byClass("adjust-menu"))
	row := find(menu, byClass("refine-row"))
	if row == nil || !hasClass(row.Parent, "adjust-content") {
		t.Fatal("refine-row is not inside .adjust-content")
	}
	const pill = "ui-pill inline-flex shrink-0 cursor-pointer items-center justify-center whitespace-nowrap rounded-md border transition text-ink "
	const sm = " gap-1.5 px-2 py-1 text-xs min-h-11 min-w-11 "
	for _, id := range []string{"softer", "direct", "shorter", "playful"} {
		chip := find(row, byTestID("refine-chip-"+id))
		if chip == nil {
			t.Fatalf("no %s chip", id)
		}
		want := pill + "border-border bg-panel hover:border-accent/60 [&>svg]:text-accent" + sm + "disabled:cursor-not-allowed disabled:opacity-40"
		if got := attrVal(chip, "class"); got != want {
			t.Errorf("%s class\n got %q\nwant %q", id, got, want)
		}
		if !hasAttr(chip, "disabled") || attrVal(chip, "aria-pressed") != "false" {
			t.Errorf("%s attributes %v", id, chip.Attr)
		}
	}
	custom := find(row, byTestID("refine-custom"))
	if custom == nil || !hasAttr(custom, "hidden") || attrVal(custom, "aria-pressed") != "true" ||
		attrVal(custom, "class") != pill+"border-accent/70 bg-accent-soft [&>svg]:text-accent"+strings.TrimRight(sm, " ") {
		t.Errorf("refine-custom %v", custom.Attr)
	}
	trigger := find(row, byTestID("refine-custom-trigger"))
	if attrVal(trigger, "class") != pill+"border-border bg-panel hover:border-accent/60"+sm+"refine-custom-trigger" ||
		attrVal(trigger, "aria-expanded") != "false" || strings.TrimSpace(textOf(trigger)) != "" {
		t.Errorf("refine-custom-trigger %v %q", trigger.Attr, textOf(trigger))
	}
	editor := find(row, byClass("refine-custom-editor"))
	input := find(editor, byTestID("refine-freeform"))
	if !hasAttr(editor, "hidden") || !hasAttr(input, "hidden") || attrVal(input, "maxlength") != "200" ||
		attrVal(input, "aria-label") != "or describe a change…" {
		t.Errorf("editor %v input %v", editor.Attr, input.Attr)
	}
	if find(editor, byTestID("refine-apply")) == nil || attrVal(find(editor, byTestID("refine-close")), "aria-label") != "Close adjustment" {
		t.Error("editor lacks Apply or Close")
	}
	notice := find(row, byTestID("refine-error"))
	if notice == nil || attrVal(notice, "class") != "mb-2 text-xs text-red-400" || !hasAttr(notice, "hidden") {
		t.Error("refine-error notice")
	}
}
