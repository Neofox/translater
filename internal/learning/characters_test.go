package learning

import "testing"

func notes(chars ...string) []CharNote {
	out := make([]CharNote, len(chars))
	for i, c := range chars {
		out[i] = CharNote{Char: c, Meaning: "m"}
	}
	return out
}

func TestIsCharacterOrigin(t *testing.T) {
	for _, tc := range []struct {
		name  string
		word  string
		chars []CharNote
		want  bool
	}{
		{"one hanja per syllable", "학교", notes("學", "校"), true},
		{"count mismatch", "사랑", notes("思", "郞", "亮"), false},
		{"non-Han char", "학교", notes("學", "a"), false},
		{"hangul char", "학교", notes("學", "교"), false},
		{"two runes in one char", "학교", notes("學校"), false},
		{"empty char", "학교", notes("學", ""), false},
		{"no chars", "학교", nil, false},
		{"japanese word needs no count", "勉強する", notes("勉", "強"), true},
		{"chinese word", "学校", notes("学", "校"), true},
	} {
		if got := IsCharacterOrigin(tc.word, tc.chars); got != tc.want {
			t.Errorf("%s: IsCharacterOrigin(%q) = %v, want %v", tc.name, tc.word, got, tc.want)
		}
	}
}

func TestIsLearningText(t *testing.T) {
	for s, want := range map[string]bool{
		"": false, " ": false, ".,!?": false, "—": false,
		"a": true, "학": true, "7": true, "€": true, "😀": true, "…a": true,
	} {
		if got := IsLearningText(s); got != want {
			t.Errorf("IsLearningText(%q) = %v, want %v", s, got, want)
		}
	}
}
