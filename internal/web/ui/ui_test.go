package ui

import (
	"context"
	"strings"
	"testing"

	"github.com/a-h/templ"
)

// A Pill is a type="button" carrying each attribute once (an HTML parser
// silently keeps only the first of two), with single-spaced class tokens.
func TestPillAttributesAreNotDuplicated(t *testing.T) {
	render := func(p PillProps) string {
		var b strings.Builder
		if err := Pill(p).Render(context.Background(), &b); err != nil {
			t.Fatal(err)
		}
		return b.String()
	}
	out := render(PillProps{Tone: "primary", Class: "copy-button  extra ", Attrs: templ.Attributes{"aria-label": "Go"}})
	if strings.Count(out, " type=") != 1 || !strings.Contains(out, `type="button"`) {
		t.Errorf("type: %s", out)
	}
	if strings.Contains(out, `  `) || strings.Contains(out, ` "`) || !strings.Contains(out, ` copy-button extra"`) {
		t.Errorf("class spacing: %s", out)
	}
	for _, name := range []string{"class", "type"} {
		func() {
			defer func() {
				if recover() == nil {
					t.Errorf("%s in Attrs must be rejected", name)
				}
			}()
			render(PillProps{Attrs: templ.Attributes{name: "x"}})
		}()
	}
}
