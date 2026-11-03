package prompt

import (
	"regexp"
	"strings"
)

// jsSpace is JavaScript's \s (RE2's \s is ASCII only): \t \n \v \f \r,
// space, NBSP, the Zs spaces, LS/PS and the BOM.
const jsSpace = `\t\n\v\f\r \x{a0}\x{1680}\x{2000}-\x{200a}\x{2028}\x{2029}\x{202f}\x{205f}\x{3000}\x{feff}`

// sentenceBreak is src/lib/longForm.ts SENTENCE_BREAK,
// /[.!?。！？…]['")\]]?\s+\S/g, with JavaScript's \s spelled out.
var sentenceBreak = regexp.MustCompile(`[.!?。！？…]['")\]]?[` + jsSpace + `]+[^` + jsSpace + `]`)

// IsLongForm ports isLongForm (src/lib/longForm.ts): multiple lines, more
// than 200 UTF-16 code units, or at least two mid-text sentence breaks
// (one is tolerated for "Mr. Smith" or "wait... what"). Alternatives only
// make sense for short single-sentence input, so the result hides them.
func IsLongForm(text string) bool {
	trimmed := JSTrim(text)
	switch {
	case trimmed == "":
		return false
	case strings.Contains(trimmed, "\n"), utf16Len(trimmed) > 200:
		return true
	}
	return len(sentenceBreak.FindAllStringIndex(trimmed, 2)) >= 2
}
