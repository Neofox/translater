package web

import (
	"bytes"
	"context"
	"strings"
	"testing"
)

// The alternatives section must not show until a row exists, and
// long-form input never gets one. It stays mounted for the streamed rows,
// so it starts under `hidden` (absent from the accessibility tree and the
// DOM snapshot); stream.js lifts it once an alternative item arrives.
func TestResultSkeletonStartsHidden(t *testing.T) {
	var b bytes.Buffer
	if err := ResultSkeleton("Alternatives").Render(context.Background(), &b); err != nil {
		t.Fatal(err)
	}
	got := b.String()
	if !strings.HasPrefix(got, `<section class="result-section detail-alternatives" aria-labelledby="alternatives-title" hidden>`) {
		t.Errorf("skeleton = %s", got)
	}
}
