// Package learning holds learner-content rules shared by the result
// templates: learning side, phrase/grammar ranges and character notes.
package learning

import "unicode"

// CharNote is one character of a character-origin note (the `chars` items
// of the result schemas' `characters`).
type CharNote struct {
	Char    string `json:"char"`
	Meaning string `json:"meaning"`
}

// CharacterNote is a word with the characters it comes from.
type CharacterNote struct {
	Word  string     `json:"word"`
	Chars []CharNote `json:"chars"`
}

// IsLearningText reports whether s has a letter, number or symbol
// (`/[\p{L}\p{N}\p{S}]/u`): text that is not punctuation or space only.
func IsLearningText(s string) bool {
	for _, r := range s {
		if unicode.In(r, unicode.L, unicode.N, unicode.S) {
			return true
		}
	}
	return false
}

// IsCharacterOrigin keeps a note only when every char is a single Han
// character and, for a word with Hangul, there is exactly one per Hangul
// character (`\p{Script=Hangul}`): models sometimes "explain" native Korean
// words by glossing their syllables as characters.
func IsCharacterOrigin(word string, chars []CharNote) bool {
	if len(chars) == 0 {
		return false
	}
	for _, c := range chars {
		runes := []rune(c.Char)
		if len(runes) != 1 || !unicode.Is(unicode.Han, runes[0]) {
			return false
		}
	}
	hangul := 0
	for _, r := range word {
		if unicode.Is(unicode.Hangul, r) {
			hangul++
		}
	}
	return hangul == 0 || hangul == len(chars)
}
