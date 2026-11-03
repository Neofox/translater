package ui

import (
	"context"
	"encoding/json/jsontext"
	"encoding/json/v2"
	"fmt"
	"io"
	"os"
	"strings"
	"testing"

	"github.com/a-h/templ"
	"github.com/google/go-cmp/cmp"
	"golang.org/x/net/html"
	"golang.org/x/net/html/atom"

	"neotranslate/internal/web/icons"
)

// reactCase is one entry of testdata/react-markup.json, written by
// `npx tsx scripts/capture-ui-markup.tsx` from the TS components.
type reactCase struct {
	Kind  string            `json:"kind"`
	Tone  string            `json:"tone"`
	Size  jsontext.Value    `json:"size"`
	Name  string            `json:"name"`
	Class string            `json:"class"`
	Attrs map[string]string `json:"attrs"`
	HTML  string            `json:"html"`
}

// TestPrimitivesMatchReact renders every captured Pill, Tag and icon case
// with templ and compares it with react-dom/server's markup: the same tag
// names, attribute sets, raw class strings (spaces included) and class token
// sequences, and the same text.
func TestPrimitivesMatchReact(t *testing.T) {
	src, err := os.ReadFile("../testdata/react-markup.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []reactCase
	if err := json.Unmarshal(src, &cases); err != nil {
		t.Fatal(err)
	}
	kinds := map[string]int{}
	for _, c := range cases {
		kinds[c.Kind]++
		var comp templ.Component
		attrs := templ.Attributes{}
		for k, v := range c.Attrs {
			attrs[k] = v
		}
		var name string
		switch c.Kind {
		case "pill":
			var size string
			if err := json.Unmarshal(c.Size, &size); err != nil {
				t.Fatal(err)
			}
			name = fmt.Sprintf("pill/%s/%s/%q", c.Tone, size, c.Class)
			comp = withChildren(Pill(PillProps{Tone: c.Tone, Size: size, Class: c.Class, Attrs: attrs}), "Label")
		case "tag":
			name = "tag/" + c.Tone
			comp = withChildren(Tag(c.Tone), "Label")
		case "icon":
			var size int
			if err := json.Unmarshal(c.Size, &size); err != nil {
				t.Fatal(err)
			}
			name = fmt.Sprintf("icon/%s/%d/%q", c.Name, size, c.Class)
			if c.Class != "" {
				attrs["class"] = c.Class
			}
			comp = icons.Icon(c.Name, size, attrs)
		default:
			t.Fatalf("unknown case kind %q", c.Kind)
		}
		t.Run(name, func(t *testing.T) {
			var b strings.Builder
			if err := comp.Render(context.Background(), &b); err != nil {
				t.Fatal(err)
			}
			want, got := parse(t, c.HTML), parse(t, b.String())
			if diff := cmp.Diff(want, got); diff != "" {
				t.Errorf("markup differs from React (-react +templ):\n%s\nreact: %s\ntempl: %s", diff, c.HTML, b.String())
			}
		})
	}
	// Pill: 5 tones × 2 sizes × 2 variants; Tag: 3 tones; icons: 3 each.
	if kinds["pill"] != 20 || kinds["tag"] != 3 || kinds["icon"] < 3 {
		t.Errorf("unexpected case counts %v: re-run scripts/capture-ui-markup.tsx", kinds)
	}
}

// withChildren passes text as the component's { children... }.
func withChildren(c templ.Component, text string) templ.Component {
	return templ.ComponentFunc(func(ctx context.Context, w io.Writer) error {
		return c.Render(templ.WithChildren(ctx, templ.Raw(text)), w)
	})
}

// node is a comparable form of an element tree.
type node struct {
	Tag     string
	Attrs   map[string]string
	Classes []string
	Text    string
	Kids    []node
}

func parse(t *testing.T, markup string) []node {
	t.Helper()
	body := &html.Node{Type: html.ElementNode, Data: "body", DataAtom: atom.Body}
	nodes, err := html.ParseFragment(strings.NewReader(markup), body)
	if err != nil {
		t.Fatal(err)
	}
	return convert(nodes)
}

func convert(nodes []*html.Node) []node {
	var out []node
	for _, n := range nodes {
		switch n.Type {
		case html.TextNode:
			out = append(out, node{Text: n.Data})
		case html.ElementNode:
			e := node{Tag: n.Data, Attrs: map[string]string{}}
			for _, a := range n.Attr {
				key := a.Key
				if a.Namespace != "" {
					key = a.Namespace + ":" + key
				}
				e.Attrs[key] = a.Val
				if a.Key == "class" {
					e.Classes = strings.Fields(a.Val)
				}
			}
			var kids []*html.Node
			for k := n.FirstChild; k != nil; k = k.NextSibling {
				kids = append(kids, k)
			}
			e.Kids = convert(kids)
			out = append(out, e)
		}
	}
	return out
}
