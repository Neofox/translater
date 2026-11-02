package main

import (
	"os"
	"strings"
	"testing"
)

func TestBase(t *testing.T) {
	got, err := Base("@import './styles/pretendard.css';\n@import 'tailwindcss';\n\n.a {\n}\n")
	if err != nil {
		t.Fatal(err)
	}
	if want := header + "\n.a {\n}\n"; got != want {
		t.Fatalf("Base = %q, want %q", got, want)
	}
	if _, err := Base(".a {}\n"); err == nil {
		t.Fatal("missing imports accepted")
	}
}

// TestStylesFresh fails when the committed copies differ from src/.
func TestStylesFresh(t *testing.T) {
	root, err := moduleRoot()
	if err != nil {
		t.Fatal(err)
	}
	outputs, err := Outputs(root)
	if err != nil {
		t.Fatal(err)
	}
	for path, want := range outputs {
		got, err := os.ReadFile(path)
		if err != nil || string(got) != want {
			t.Errorf("%s is stale: run `go generate ./...` in go/", strings.TrimPrefix(path, root+"/"))
		}
	}
}
