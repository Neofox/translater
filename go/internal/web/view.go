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

func chipTone(pressed bool) string {
	if pressed {
		return "active"
	}
	return "neutral"
}
