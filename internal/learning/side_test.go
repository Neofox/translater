package learning

import "testing"

// TestSide: the source is analysed only when translating into the UI
// language from another language.
func TestSide(t *testing.T) {
	for _, tc := range []struct{ source, target, uiLang, want string }{
		{"ko", "en", "en", "source"},
		{"en", "ko", "en", "target"},
		{"en", "ko", "ko", "source"},
		{"ko", "en", "ko", "target"},
		{"ja", "en", "en", "source"},
		{"ko", "ja", "en", "target"},
		{"en", "en", "en", "target"},
	} {
		name := "learns " + tc.source + " → " + tc.target + " with " + tc.uiLang + " UI from the " + tc.want + " side"
		t.Run(name, func(t *testing.T) {
			if got := Side(tc.source, tc.target, tc.uiLang); got != tc.want {
				t.Errorf("Side(%q, %q, %q) = %q, want %q", tc.source, tc.target, tc.uiLang, got, tc.want)
			}
		})
	}
}
