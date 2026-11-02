package web

import (
	"strings"

	"neotranslate/internal/contract"
	"neotranslate/internal/prefs"
)

// View is everything the page templates read: the request's preferences,
// the shared contract (strings, languages) and the hashed asset URLs.
type View struct {
	Prefs    prefs.Preferences
	Contract *contract.Contract
	Static   *Static
	// Data is the JSON the client modules start from (#nt-data).
	Data string
}

// T is the UI string for key in the request's UI language.
func (v View) T(key string) string { return v.Contract.T(v.Prefs.UILang, key) }

// Asset is the hashed URL of a static file ("js/app.js").
func (v View) Asset(name string) string { return v.Static.URL(name) }

var modes = []struct{ Value, Key string }{
	{"friends", "modeFriends"}, {"casual", "modeCasual"}, {"professional", "modeProfessional"},
}

// fixedChips are always shown; one more "recent" chip follows
// (LanguageChipBar.tsx).
var fixedChips = map[string][]string{"source": {"auto", "en", "ko"}, "target": {"en", "ko"}}

type chip struct {
	Code, Label, Short string
	Pressed            bool
}

func (v View) label(code string) string {
	for _, l := range v.Contract.Languages {
		if l.Code == code {
			return l.Label
		}
	}
	return code
}

// chips lists a bar's chips: the fixed ones plus the selected non-fixed
// language, or else the recent one.
func (v View) chips(kind string) []chip {
	value, recent := v.Prefs.Source, v.Prefs.RecentSource
	if kind == "target" {
		value, recent = v.Prefs.Target, v.Prefs.RecentTarget
	}
	codes := append([]string(nil), fixedChips[kind]...)
	promoted := value
	if contains(codes, value) {
		promoted = ""
		if recent != nil {
			promoted = *recent
		}
	}
	if promoted != "" && !contains(codes, promoted) {
		codes = append(codes, promoted)
	}
	out := make([]chip, len(codes))
	for i, code := range codes {
		short := strings.ToUpper(code)
		if code == "auto" {
			short = "Auto"
		}
		out[i] = chip{Code: code, Label: v.label(code), Short: short, Pressed: code == value}
	}
	return out
}

func contains(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}

// Pill class strings (src/components/ui/Pill.tsx).
var (
	pillTone = map[string]string{
		"primary": "border-transparent bg-accent text-bg hover:brightness-110",
		"neutral": "border-border bg-panel hover:border-accent/60",
		"active":  "border-accent/70 bg-accent-soft [&>svg]:text-accent",
	}
	pillSize = map[string]string{
		"sm": "gap-1.5 px-2 py-1 text-xs min-h-11 min-w-11",
		"md": "gap-2 px-3 py-1.5 text-sm min-h-11 min-w-11",
	}
)

func pill(tone, size, extra string) string {
	c := "ui-pill inline-flex shrink-0 cursor-pointer items-center justify-center whitespace-nowrap rounded-md border transition"
	if tone != "primary" {
		c += " text-ink"
	}
	c += " " + pillTone[tone] + " " + pillSize[size]
	if extra != "" {
		c += " " + extra
	}
	return c
}

func chipTone(pressed bool) string {
	if pressed {
		return "active"
	}
	return "neutral"
}

func uiLangClass(pressed bool) string {
	c := "cursor-pointer rounded px-2 py-0.5 font-semibold tracking-wide transition "
	if pressed {
		return c + "bg-accent text-bg shadow-sm"
	}
	return c + "text-ink-soft hover:text-ink"
}
