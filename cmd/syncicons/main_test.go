package main

import (
	"os"
	"path/filepath"
	"testing"

	"encoding/json/jsontext"
)

func TestParseNames(t *testing.T) {
	got, err := ParseNames("# comment\n\nx\nloader-circle loader-2\n")
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0].Name != "x" || len(got[0].Aliases) != 0 ||
		got[1].Name != "loader-circle" || len(got[1].Aliases) != 1 || got[1].Aliases[0] != "loader-2" {
		t.Fatalf("ParseNames = %+v", got)
	}
	if _, err := ParseNames("x\nx\n"); err == nil {
		t.Fatal("duplicate name accepted")
	}
}

func TestChildren(t *testing.T) {
	got, err := Children(jsontext.Value(`[["rect",{"width":"8","x":"8","rx":"1"}],["path",{"d":"M1 2&<"}]]`))
	if err != nil {
		t.Fatal(err)
	}
	if want := `<rect width="8" x="8" rx="1"></rect><path d="M1 2&amp;&lt;"></path>`; got != want {
		t.Fatalf("Children = %q, want %q", got, want)
	}
	if _, err := Children(jsontext.Value(`[["g",{},[["path",{}]]]]`)); err == nil {
		t.Fatal("nested nodes accepted")
	}
}

// TestIconsFresh fails when icons_gen.go differs from names.txt and the
// installed lucide-static.
func TestIconsFresh(t *testing.T) {
	root, err := moduleRoot()
	if err != nil {
		t.Fatal(err)
	}
	want, err := Output(root)
	if err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(filepath.Join(root, "internal", "web", "icons", "icons_gen.go"))
	if err != nil || string(got) != string(want) {
		t.Error("internal/web/icons/icons_gen.go is stale: run `go generate ./...`")
	}
}
