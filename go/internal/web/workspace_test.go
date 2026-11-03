package web

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"golang.org/x/net/html"
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

// The server paints TS's COMPACT_LAYOUT (TranslatorWorkspace.tsx before
// the first measure): layout.js replaces it, CSS container queries choose
// the startup arrangement until then.
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
