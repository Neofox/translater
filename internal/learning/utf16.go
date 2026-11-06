package learning

import (
	"slices"
	"unicode/utf16"

	"github.com/rivo/uniseg"
)

// Offsets sent to the browser are UTF-16 code units: the units of the
// textarea's selection, Range.toString().length and JS string slicing. The
// helpers here work on []uint16 so every comparison in Prepare matches the
// same comparison on a JS string.

// encode returns the UTF-16 code units of s.
func encode(s string) []uint16 { return utf16.Encode([]rune(s)) }

// decode returns the string of UTF-16 units u.
func decode(u []uint16) string { return string(utf16.Decode(u)) }

// indexOf is String.prototype.indexOf(needle, from): from is clamped to
// [0, len(h)], and an empty needle is found at the clamped from.
func indexOf(h, needle []uint16, from int) int {
	from = min(max(from, 0), len(h))
	if len(needle) == 0 {
		return from
	}
	for i := from; i+len(needle) <= len(h); i++ {
		if slices.Equal(h[i:i+len(needle)], needle) {
			return i
		}
	}
	return -1
}

// lastIndexOf is String.prototype.lastIndexOf(needle, from): from is clamped
// to [0, len(h)] (a negative from searches only at 0), and an empty needle is
// found at the clamped from. Pass len(h) for the no-argument form.
func lastIndexOf(h, needle []uint16, from int) int {
	from = min(max(from, 0), len(h))
	if len(needle) == 0 {
		return from
	}
	for i := min(from, len(h)-len(needle)); i >= 0; i-- {
		if slices.Equal(h[i:i+len(needle)], needle) {
			return i
		}
	}
	return -1
}

// boundaries is the set of UTF-16 offsets at extended grapheme cluster
// boundaries of s, including 0 and its length (as Intl.Segmenter with
// granularity "grapheme" finds them). Known divergence: uniseg v0.4.7 implements
// Unicode 15.0, without the Indic conjunct rule (GB9c) that current browsers
// apply, so Indic conjuncts such as क्ष split here but not in the browser.
// Outside the app's language set; the frozen regression corpus
// (testdata/corpus.json) has no Indic text.
func boundaries(s string) map[int]bool {
	points := map[int]bool{0: true}
	offset := 0
	g := uniseg.NewGraphemes(s)
	for g.Next() {
		for _, r := range g.Runes() {
			offset += utf16.RuneLen(r)
		}
		points[offset] = true
	}
	return points
}
