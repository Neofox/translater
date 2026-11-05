package web

import (
	"strings"
	"testing"

	"golang.org/x/net/html"
)

// The learning surface (LearningPanel.tsx) waits mounted and hidden at the
// end of .output-panel. TS unmounts it; base.css selects on
// .learning-panel[data-expanded], so the hidden copy carries no
// data-expanded (learning.js sets both when it opens).
func TestLearningPanelShell(t *testing.T) {
	doc := renderPage(t)
	output := find(doc, byClass("output-panel"))
	kids := elementChildren(output)
	panel := kids[len(kids)-1]
	if attrVal(panel, "data-testid") != "learning-panel" || panel.Data != "section" || !hasClass(panel, "learning-panel") {
		t.Fatalf("last .output-panel child is not the learning panel: <%s class=%q>", panel.Data, attrVal(panel, "class"))
	}
	if !hasAttr(panel, "hidden") || hasAttr(panel, "data-expanded") || attrVal(panel, "aria-label") != "Learn" {
		t.Errorf("panel attributes: %v", panel.Attr)
	}
	parts := elementChildren(panel)
	if len(parts) != 2 || attrVal(parts[0], "class") != "learning-panel-header" ||
		attrVal(parts[1], "class") != "learning-panel-body scrollbar-thin" {
		t.Fatalf("panel children: %d", len(parts))
	}
	head := elementChildren(parts[0])
	if len(head) != 2 || head[0].Data != "h2" || textOf(head[0]) != "Learn" {
		t.Fatalf("header: %d children", len(head))
	}
	closer := head[1]
	if closer.Data != "button" || attrVal(closer, "aria-label") != "Close learning" ||
		!strings.Contains(attrVal(closer, "class"), "ui-pill") || !strings.Contains(attrVal(closer, "class"), "min-h-11") {
		t.Errorf("close button: %v", closer.Attr)
	}
	if svg := find(closer, func(n *html.Node) bool { return n.Data == "svg" }); svg == nil ||
		!hasClass(svg, "lucide-x") || attrVal(svg, "width") != "18" {
		t.Error("close button lacks the X 18 icon")
	}
	if len(elementChildren(parts[1])) != 0 {
		t.Error("the body starts empty: learning.js moves the inspector in")
	}
}

func textOf(n *html.Node) string {
	var b strings.Builder
	var walk func(*html.Node)
	walk = func(n *html.Node) {
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
