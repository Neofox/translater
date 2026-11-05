package web

import (
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"

	"golang.org/x/net/html"

	"neotranslate/internal/prefs"
)

// A UI-language switch relabels the page in place (prefs.js applyStrings)
// and re-renders only the chip bars (/prefs). So every text node or
// attribute that differs between the en and ko pages must be covered by
// [data-t] / [data-t-attr], or sit inside a re-rendered bar, or be one of
// the few values the client sets itself.
func TestUILanguageDifferencesAreRelabelled(t *testing.T) {
	p, c := newPages(t)
	render := func(ui string) *html.Node {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.AddCookie(prefs.Cookie(prefs.Preferences{Source: "auto", Target: "ko", Mode: "casual", UILang: ui}, c.Prefs, false))
		rec := httptest.NewRecorder()
		p.HandlePage(rec, req)
		doc, err := html.Parse(rec.Body)
		if err != nil {
			t.Fatal(err)
		}
		return doc
	}
	en, ko := render("en"), render("ko")
	differences := 0
	var walk func(a, b *html.Node)
	walk = func(a, b *html.Node) {
		if a.Type != b.Type || (a.Type != html.TextNode && a.Data != b.Data) {
			t.Fatalf("structure differs: %q vs %q at %s", a.Data, b.Data, nodePath(a))
		}
		if a.Type == html.TextNode && a.Data != b.Data {
			differences++
			if !textCovered(a) {
				t.Errorf("text %q / %q at %s is not relabelled", a.Data, b.Data, nodePath(a))
			}
		}
		if a.Type == html.ElementNode {
			for _, attr := range a.Attr {
				if attr.Val != attrVal(b, attr.Key) {
					differences++
					if !attrCovered(a, attr.Key) {
						t.Errorf("attribute %s=%q / %q at %s is not relabelled", attr.Key, attr.Val, attrVal(b, attr.Key), nodePath(a))
					}
				}
			}
		}
		ca, cb := a.FirstChild, b.FirstChild
		for ; ca != nil && cb != nil; ca, cb = ca.NextSibling, cb.NextSibling {
			walk(ca, cb)
		}
		if ca != nil || cb != nil {
			t.Fatalf("child count differs at %s", nodePath(a))
		}
	}
	walk(en, ko)
	if differences < 20 {
		t.Fatalf("only %d differences: the pages were not rendered in two languages", differences)
	}
}

func attrVal(n *html.Node, key string) string {
	for _, a := range n.Attr {
		if a.Key == key {
			return a.Val
		}
	}
	return ""
}

func hasClass(n *html.Node, class string) bool {
	return slices.Contains(strings.Fields(attrVal(n, "class")), class)
}

// inBar reports whether n is inside a chip bar that /prefs re-renders.
func inBar(n *html.Node) bool {
	for ; n != nil; n = n.Parent {
		if id := attrVal(n, "id"); n.Type == html.ElementNode && (id == "source-bar" || id == "target-bar") {
			return true
		}
	}
	return false
}

func textCovered(n *html.Node) bool {
	parent := n.Parent
	switch {
	case inBar(n):
		return true
	case attrVal(parent, "data-t") != "":
		return true
	case hasClass(parent, "input-count"): // updateCount() rewrites it
		return true
	case parent.Parent != nil && attrVal(parent.Parent, "data-testid") == "adjust-button": // adjust.js adds the summary
		return true
	case parent.Data == "script" && attrVal(parent, "id") == "nt-data": // prefs.uiLang
		return true
	}
	return false
}

func attrCovered(n *html.Node, key string) bool {
	if inBar(n) {
		return true
	}
	for _, pair := range strings.Fields(attrVal(n, "data-t-attr")) {
		if attr, _, _ := strings.Cut(pair, ":"); attr == key {
			return true
		}
	}
	switch {
	case n.Data == "html" && key == "lang": // applyStrings sets it
		return true
	case attrVal(n, "data-testid") == "adjust-button" && key == "aria-label": // adjust.js adds the summary
		return true
	case n.Parent != nil && attrVal(n.Parent, "aria-label") == "UI language" && (key == "aria-pressed" || key == "class"): // syncControls
		return true
	}
	return false
}

func nodePath(n *html.Node) string {
	var parts []string
	for ; n != nil; n = n.Parent {
		if n.Type != html.ElementNode {
			continue
		}
		s := n.Data
		if id := attrVal(n, "id"); id != "" {
			s += "#" + id
		} else if c := attrVal(n, "class"); c != "" {
			s += "." + strings.Fields(c)[0]
		}
		parts = append([]string{s}, parts...)
	}
	return strings.Join(parts, " > ")
}
