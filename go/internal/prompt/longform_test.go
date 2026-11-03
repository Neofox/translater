package prompt

import (
	"strings"
	"testing"
)

func TestIsLongForm(t *testing.T) {
	cases := []struct {
		text string
		want bool
	}{
		{"", false},
		{"   \n  ", false},
		{"Hi.\nThere", true},
		{"  one line  \n", false}, // trimmed first
		{strings.Repeat("a", 201), true},
		{strings.Repeat("a", 200), false},
		// UTF-16 length: 100 emoji are 200 code units, 101 are 202.
		{strings.Repeat("😀", 100), false},
		{strings.Repeat("😀", 101), true},
		{"Mr. Smith arrived. He sat. Done.", true},
		{"wait... what", false},
		{"Mr. Smith arrived.", false},
		{`He said "Stop." Then he left. Fine`, true},
		{"今日は。明日も。 では", false},
		// JavaScript \s covers the ideographic space and NBSP.
		{"一。　二。　三", true},
		{"One. Two. Three", true},
		{"Wow!!  Really?  Yes", true},
	}
	for _, c := range cases {
		if got := IsLongForm(c.text); got != c.want {
			t.Errorf("IsLongForm(%q) = %v, want %v", c.text, got, c.want)
		}
	}
}
