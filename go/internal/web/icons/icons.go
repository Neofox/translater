// Package icons renders lucide icons exactly as lucide-react 1.61.0 does
// (TestPrimitivesMatchReact). The SVG children come from lucide-static via
// cmd/syncicons (icons_gen.go); names.txt lists the icons the UI uses.
//
// Hand-written: a templ component would need one template per icon; this is
// one renderer over the generated table.
package icons

//go:generate go run ../../../cmd/syncicons

import (
	"context"
	"fmt"
	"html"
	"io"
	"slices"
	"strconv"
	"strings"

	"github.com/a-h/templ"
)

type icon struct {
	aliases  []string
	children string
}

// Icon is lucide-react's <Name size={size} {...attrs}/>: the default
// attributes, `class="lucide lucide-<name> lucide-<alias>… <attrs.class>"`
// (duplicates dropped, as mergeClasses does) and `aria-hidden="true"` unless
// attrs carry an accessible name (aria-*, role or title). Other attrs follow
// in name order. An unknown name panics: names.txt is fixed at build time.
func Icon(name string, size int, attrs templ.Attributes) templ.Component {
	ic, ok := icons[name]
	if !ok {
		panic(fmt.Sprintf("icons: %q is not in names.txt", name))
	}
	classes := []string{"lucide", "lucide-" + name}
	for _, a := range ic.aliases {
		classes = append(classes, "lucide-"+a)
	}
	accessible := false
	keys := make([]string, 0, len(attrs))
	for k := range attrs {
		if k == "class" {
			if s, ok := attrs[k].(string); ok {
				classes = append(classes, strings.Fields(s)...)
			}
			continue
		}
		if strings.HasPrefix(k, "aria-") || k == "role" || k == "title" {
			accessible = true
		}
		keys = append(keys, k)
	}
	slices.Sort(keys)
	merged := classes[:0:0]
	for _, c := range classes {
		if !slices.Contains(merged, c) {
			merged = append(merged, c)
		}
	}
	px := strconv.Itoa(size)
	return templ.ComponentFunc(func(_ context.Context, w io.Writer) error {
		var b strings.Builder
		b.WriteString(`<svg xmlns="http://www.w3.org/2000/svg" width="` + px + `" height="` + px +
			`" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="` +
			html.EscapeString(strings.Join(merged, " ")) + `"`)
		if !accessible {
			b.WriteString(` aria-hidden="true"`)
		}
		for _, k := range keys {
			switch v := attrs[k].(type) {
			case string:
				b.WriteString(" " + k + `="` + html.EscapeString(v) + `"`)
			case bool:
				if v {
					b.WriteString(" " + k)
				}
			default:
				return fmt.Errorf("icons: attribute %s has unsupported type %T", k, v)
			}
		}
		b.WriteString(">" + ic.children + "</svg>")
		_, err := io.WriteString(w, b.String())
		return err
	})
}
