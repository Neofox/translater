package learning

import "testing"

// TestJSIndexSemantics pins String.prototype.indexOf / lastIndexOf behaviour
// on UTF-16 code units, which every range comparison relies on.
func TestJSIndexSemantics(t *testing.T) {
	h := encode("abcabc")
	for _, tc := range []struct {
		name   string
		last   bool
		needle string
		from   int
		want   int
	}{
		{"indexOf finds the first match", false, "bc", 0, 1},
		{"indexOf starts at from", false, "bc", 2, 4},
		{"indexOf misses past the last match", false, "bc", 5, -1},
		{"indexOf negative from is 0", false, "a", -3, 0},
		{"indexOf empty needle returns from", false, "", 4, 4},
		{"indexOf empty needle clamps from to length", false, "", 99, 6},
		{"indexOf empty needle clamps negative from to 0", false, "", -1, 0},
		{"indexOf needle longer than text", false, "abcabcabc", 0, -1},
		{"lastIndexOf finds the last match", true, "bc", 6, 4},
		{"lastIndexOf searches at or before from", true, "bc", 3, 1},
		{"lastIndexOf match may start exactly at from", true, "bc", 4, 4},
		{"lastIndexOf negative from is clamped to 0", true, "ab", -2, 0},
		{"lastIndexOf negative from misses a later-only match", true, "bc", -2, -1},
		{"lastIndexOf empty needle returns from", true, "", 2, 2},
		{"lastIndexOf empty needle clamps from to length", true, "", 99, 6},
		{"lastIndexOf empty needle clamps negative from to 0", true, "", -5, 0},
		{"lastIndexOf needle longer than text", true, "abcabcabc", 9, -1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := indexOf
			if tc.last {
				f = lastIndexOf
			}
			if got := f(h, encode(tc.needle), tc.from); got != tc.want {
				t.Errorf("got %d, want %d", got, tc.want)
			}
		})
	}
	// Astral characters are two code units.
	if got := indexOf(encode("😀x"), encode("x"), 0); got != 2 {
		t.Errorf("indexOf after an emoji = %d, want 2", got)
	}
}

func TestBoundaries(t *testing.T) {
	// 👍🏽 (4 units, one grapheme), e + U+0301 (2 units, one grapheme), 가.
	got := boundaries("👍🏽é가")
	for _, want := range []int{0, 4, 6, 7} {
		if !got[want] {
			t.Errorf("missing boundary %d in %v", want, got)
		}
	}
	for _, not := range []int{1, 2, 3, 5} {
		if got[not] {
			t.Errorf("unexpected boundary %d in %v", not, got)
		}
	}
	// Conjoining jamo ᄀ+ᅡ+ᆨ form one Hangul syllable grapheme (GB6–8).
	if jamo := boundaries("각x"); len(jamo) != 3 || !jamo[0] || !jamo[3] || !jamo[4] {
		t.Errorf("conjoining jamo boundaries = %v, want {0, 3, 4}", jamo)
	}
	if empty := boundaries(""); len(empty) != 1 || !empty[0] {
		t.Errorf("boundaries(\"\") = %v, want {0}", empty)
	}
}
