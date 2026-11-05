package icons

import (
	"context"
	"strings"
	"testing"

	"github.com/a-h/templ"
)

func render(t *testing.T, c templ.Component) string {
	t.Helper()
	var b strings.Builder
	if err := c.Render(context.Background(), &b); err != nil {
		t.Fatal(err)
	}
	return b.String()
}

// Alias classes merge with the caller's, aria-hidden yields to an accessible
// role, and an unknown icon panics.
func TestIcon(t *testing.T) {
	got := render(t, Icon("loader-circle", 18, templ.Attributes{"class": "lucide animate-spin", "data-x": "1"}))
	if !strings.Contains(got, `class="lucide lucide-loader-circle lucide-loader-2 animate-spin" aria-hidden="true" data-x="1">`) {
		t.Errorf("classes not merged like mergeClasses: %s", got)
	}
	if got := render(t, Icon("x", 16, templ.Attributes{"role": "img"})); strings.Contains(got, "aria-hidden") {
		t.Errorf("aria-hidden with an accessible role: %s", got)
	}
	defer func() {
		if recover() == nil {
			t.Error("unknown icon accepted")
		}
	}()
	Icon("not-an-icon", 16, nil)
}
