package web

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"golang.org/x/net/html"

	"neotranslate/internal/web/ui"
)

func renderPage(t *testing.T) *html.Node {
	t.Helper()
	p, _ := newPages(t)
	rec := httptest.NewRecorder()
	p.HandlePage(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	doc, err := html.Parse(rec.Body)
	if err != nil {
		t.Fatal(err)
	}
	return doc
}

// find returns the first element matching ok, depth first.
func find(n *html.Node, ok func(*html.Node) bool) *html.Node {
	if n.Type == html.ElementNode && ok(n) {
		return n
	}
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		if m := find(c, ok); m != nil {
			return m
		}
	}
	return nil
}

func byClass(class string) func(*html.Node) bool {
	return func(n *html.Node) bool { return hasClass(n, class) }
}

func byTestID(id string) func(*html.Node) bool {
	return func(n *html.Node) bool { return attrVal(n, "data-testid") == id }
}

func hasAttr(n *html.Node, key string) bool {
	for _, a := range n.Attr {
		if a.Key == key {
			return true
		}
	}
	return false
}

func elementChildren(n *html.Node) []*html.Node {
	var out []*html.Node
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		if c.Type == html.ElementNode {
			out = append(out, c)
		}
	}
	return out
}

// The server paints the compact stacked layout: layout.js replaces it after
// the first measure, and CSS container queries choose the startup
// arrangement until then.
func TestFirstPaintIsTheCompactLayout(t *testing.T) {
	doc := renderPage(t)
	shell := find(doc, byClass("app-shell"))
	if shell == nil || shell.Data != "main" || attrVal(shell, "data-layout") != "stack" {
		t.Fatal("main.app-shell[data-layout=stack] missing")
	}
	for _, key := range []string{"data-result-first", "data-desktop", "data-short", "data-tight", "data-keyboard", "data-layout-pending"} {
		if hasAttr(shell, key) {
			t.Errorf("app-shell has %s", key)
		}
	}
	panels := find(doc, byClass("translator-panels"))
	if panels == nil || !hasClass(panels.Parent, "workspace-viewport") || panels.Parent.Parent != shell {
		t.Fatal("main > div.workspace-viewport > div.translator-panels missing")
	}
	for key, want := range map[string]string{"data-layout-pending": "true", "data-layout": "stack", "data-result-first": "true"} {
		if attrVal(panels, key) != want {
			t.Errorf("panels %s = %q, want %q", key, attrVal(panels, key), want)
		}
	}
	for _, key := range []string{"data-desktop", "data-short", "data-tight", "data-keyboard"} {
		if hasAttr(panels, key) {
			t.Errorf("panels have %s", key)
		}
	}
	kids := elementChildren(panels)
	if len(kids) != 2 || !hasClass(kids[0], "output-panel") || !hasClass(kids[1], "input-panel") {
		t.Fatal("panels must be output then input")
	}
}

// Reply context: the toggle in composer-meta and the field template.
func TestContextToggleAndField(t *testing.T) {
	doc := renderPage(t)
	meta := find(doc, byClass("composer-meta"))
	if meta == nil {
		t.Fatal("composer-meta missing")
	}
	kids := elementChildren(meta)
	if len(kids) != 2 || attrVal(kids[0], "data-testid") != "context-toggle" || !hasClass(kids[1], "input-count") {
		t.Fatal("composer-meta must hold the context toggle, then the count")
	}
	toggle := kids[0]
	for key, want := range map[string]string{
		"type":              "button",
		"class":             ui.PillClass("neutral", "md", "context-toggle"),
		"data-active-class": ui.PillClass("active", "md", "context-toggle"),
		"aria-expanded":     "false",
		"aria-label":        "Replying to…",
		"title":             "Replying to…",
	} {
		if got := attrVal(toggle, key); got != want {
			t.Errorf("toggle %s = %q, want %q", key, got, want)
		}
	}
	icon := elementChildren(toggle)
	if len(icon) != 3 || !hasClass(icon[0], "lucide-reply") || !hasClass(icon[1], "context-toggle-label") || !hasClass(icon[2], "context-toggle-short-label") {
		t.Fatal("toggle must hold the Reply icon and both labels")
	}
	if icon[1].FirstChild.Data != "Replying to…" || icon[2].FirstChild.Data != "Context" {
		t.Error("toggle labels")
	}

	// Closed, the page has no composer-context, and base.css selects on its
	// presence: the field is a template context.js inserts.
	field := find(doc, byClass("composer-field"))
	if find(field, byClass("composer-context")) != nil {
		t.Fatal("composer-field must not hold the closed context field")
	}
	tmpl := find(doc, func(n *html.Node) bool { return n.Data == "template" && attrVal(n, "id") == "context-field" })
	if tmpl == nil {
		t.Fatal("template#context-field missing")
	}
	kids = elementChildren(tmpl)
	if len(kids) != 1 || attrVal(kids[0], "class") != "composer-context" || hasAttr(kids[0], "hidden") {
		t.Fatal("template#context-field > div.composer-context")
	}
	box := elementChildren(kids[0])
	if len(box) != 1 || attrVal(box[0], "class") != "context-field" {
		t.Fatal("div.composer-context > div.context-field")
	}
	ta := find(box[0], byTestID("context-textarea"))
	if ta == nil || ta.Data != "textarea" {
		t.Fatal("context textarea missing")
	}
	for key, want := range map[string]string{
		"maxlength":   "1000",
		"placeholder": "Paste the message you are replying to…",
		"aria-label":  "Replying to…",
		"class":       "field-sizing-content max-h-24 min-h-12 w-full resize-none bg-transparent px-4 py-2 pr-12 text-sm leading-relaxed text-ink placeholder:text-ink-dim focus:outline-none scrollbar-thin",
	} {
		if got := attrVal(ta, key); got != want {
			t.Errorf("context textarea %s = %q, want %q", key, got, want)
		}
	}
	clear := find(box[0], byTestID("context-clear"))
	if clear == nil || !hasAttr(clear, "hidden") || attrVal(clear, "aria-label") != "Clear context" ||
		attrVal(clear, "class") != "absolute right-1 top-1 inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded text-ink transition hover:text-accent" {
		t.Fatal("hidden context-clear button")
	}
	if find(clear, byClass("lucide-x")) == nil {
		t.Error("context-clear has the X icon")
	}
	// The context field is no form field and sits outside every swap target.
	if strings.Contains(attrVal(ta, "name"), "context") {
		t.Error("context textarea must not be a form field")
	}
}
