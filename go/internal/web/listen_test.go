package web

import (
	"bytes"
	"context"
	"testing"

	"golang.org/x/net/html"
)

// ListenButton.tsx at rest: a disabled neutral Pill inside its relative
// wrapper, Volume2 shown, Loader2 and Square mounted hidden for speech.js.
// The main toolbar's is labelled (md); alternative rows use the compact sm
// icon-action variant.
func TestListenButtonMarkup(t *testing.T) {
	const neutral = "ui-pill inline-flex shrink-0 cursor-pointer items-center justify-center whitespace-nowrap rounded-md border transition text-ink border-border bg-panel hover:border-accent/60 "
	main := find(find(renderPage(t), byTestID("output-toolbar")), byTestID("listen-button"))
	var b bytes.Buffer
	if err := AlternativeRow(0, false, "안녕", "", nil, "Copy", "Listen").Render(context.Background(), &b); err != nil {
		t.Fatal(err)
	}
	row, err := html.Parse(&b)
	if err != nil {
		t.Fatal(err)
	}
	alt := find(row, byTestID("listen-button"))
	for _, c := range []struct {
		name     string
		button   *html.Node
		class    string
		labelled bool
	}{
		{"main", main, neutral + "gap-2 px-3 py-1.5 text-sm min-h-11 min-w-11 listen-button  disabled:cursor-not-allowed disabled:opacity-50", true},
		{"alternative", alt, neutral + "gap-1.5 px-2 py-1 text-xs min-h-11 min-w-11 listen-button icon-action disabled:cursor-not-allowed disabled:opacity-50", false},
	} {
		t.Run(c.name, func(t *testing.T) {
			if c.button == nil {
				t.Fatal("no listen button")
			}
			wrapper := c.button.Parent
			if wrapper.Data != "span" || attrVal(wrapper, "class") != "relative inline-flex shrink-0" || len(elementChildren(wrapper)) != 1 {
				t.Errorf("wrapper <%s class=%q>", wrapper.Data, attrVal(wrapper, "class"))
			}
			if got := attrVal(c.button, "class"); got != c.class {
				t.Errorf("class\n got %q\nwant %q", got, c.class)
			}
			for key, want := range map[string]string{"aria-label": "Listen", "title": "Listen", "aria-pressed": "false", "aria-busy": "false"} {
				if got := attrVal(c.button, key); got != want {
					t.Errorf("%s = %q, want %q", key, got, want)
				}
			}
			if !hasAttr(c.button, "disabled") || hasAttr(c.button, "aria-describedby") {
				t.Errorf("attributes %v", c.button.Attr)
			}
			kids := elementChildren(c.button)
			icons := map[string]string{"loading": "lucide-loader-circle", "stop": "lucide-square", "listen": "lucide-volume-2"}
			for i, icon := range []string{"loading", "stop", "listen"} {
				svg := kids[i]
				if svg.Data != "svg" || attrVal(svg, "data-icon") != icon || !hasClass(svg, icons[icon]) || attrVal(svg, "width") != "14" {
					t.Errorf("icon %d: <%s %v>", i, svg.Data, svg.Attr)
				}
				if hasAttr(svg, "hidden") != (icon != "listen") {
					t.Errorf("%s icon hidden = %v", icon, hasAttr(svg, "hidden"))
				}
			}
			if !hasClass(kids[0], "animate-spin") || !hasClass(kids[0], "motion-reduce:animate-none") {
				t.Errorf("loader classes %q", attrVal(kids[0], "class"))
			}
			if c.labelled {
				if len(kids) != 4 || kids[3].Data != "span" || textOf(kids[3]) != "Listen" || attrVal(kids[3], "data-t") != "listen" {
					t.Errorf("label: %d children", len(kids))
				}
				if attrVal(c.button, "data-t-attr") != "aria-label:listen title:listen" {
					t.Errorf("data-t-attr %q", attrVal(c.button, "data-t-attr"))
				}
			} else if len(kids) != 3 {
				t.Errorf("icon-only button has %d children", len(kids))
			}
		})
	}
}
