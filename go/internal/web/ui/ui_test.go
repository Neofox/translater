package ui

import (
	"context"
	"strings"
	"testing"

	"github.com/a-h/templ"
)

// A caller's type wins over the default type="button", and the markup
// carries each attribute once (an HTML parser silently keeps only the first
// of two).
func TestPillAttributesAreNotDuplicated(t *testing.T) {
	render := func(attrs templ.Attributes) string {
		var b strings.Builder
		if err := Pill(PillProps{Attrs: attrs}).Render(context.Background(), &b); err != nil {
			t.Fatal(err)
		}
		return b.String()
	}
	out := render(templ.Attributes{"type": "submit", "aria-label": "Go"})
	if strings.Count(out, " type=") != 1 || !strings.Contains(out, `type="submit"`) {
		t.Errorf("type override: %s", out)
	}
	if out := render(nil); strings.Count(out, " type=") != 1 || !strings.Contains(out, `type="button"`) {
		t.Errorf("default type: %s", out)
	}
	defer func() {
		if recover() == nil {
			t.Error("a class in Attrs must be rejected: pass it as PillProps.Class")
		}
	}()
	render(templ.Attributes{"class": "x"})
}
