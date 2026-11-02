// Command syncshared copies the repository's language-neutral translation
// contract (../shared/translation: prompt templates, few-shots, schemas,
// strings, golden request fixtures) into internal/contract/data so the Go
// app can go:embed it; go:embed cannot reach outside the module.
//
// Hand-written because it is only os.RemoveAll + os.CopyFS (stdlib); no
// library is needed. The copy is exact and deterministic: the destination is
// removed first, so deleted or renamed source files disappear too, and two
// runs produce no diff. Run via `go generate ./...` in go/; CI fails when
// the committed copy is stale.
package main

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "syncshared:", err)
		os.Exit(1)
	}
}

func run() error {
	root, err := moduleRoot()
	if err != nil {
		return err
	}
	src := filepath.Join(root, "..", "shared", "translation")
	dst := filepath.Join(root, "internal", "contract", "data")
	if info, err := os.Stat(src); err != nil || !info.IsDir() {
		return fmt.Errorf("source %s is not a directory: %v", src, err)
	}
	if err := os.RemoveAll(dst); err != nil {
		return err
	}
	// CopyFS refuses to overwrite, which the RemoveAll above guarantees.
	return os.CopyFS(dst, os.DirFS(src))
}

// moduleRoot walks up from the working directory (go generate runs in the
// package directory) to the directory holding go.mod.
func moduleRoot() (string, error) {
	dir, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return dir, nil
		} else if !errors.Is(err, fs.ErrNotExist) {
			return "", err
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", errors.New("go.mod not found above the working directory")
		}
		dir = parent
	}
}
