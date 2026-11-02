// Package prefs reads and writes the shared nt.preferences cookie. The format
// is byte-compatible with the TypeScript app (src/lib/preferences.ts): a
// version-1 JSON object in the rule order of shared/translation/preferences.json,
// encodeURIComponent-escaped. Never put source text or generated content here.
package prefs

import (
	"encoding/json/jsontext"
	"encoding/json/v2"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"unicode/utf16"

	"neotranslate/internal/contract"
)

// Preferences are the saved UI preferences.
type Preferences struct {
	Source       string
	Target       string
	Mode         string
	UILang       string
	RecentSource *string
	RecentTarget *string
}

// Snapshot is the preferences for a request and whether a valid cookie existed.
type Snapshot struct {
	Preferences Preferences
	HasCookie   bool
}

// Defaults mirrors defaultPreferences(locale): the UI language follows the
// first Accept-Language entry, the target is the other of en/ko.
func Defaults(acceptLanguage string) Preferences {
	first, _, _ := strings.Cut(acceptLanguage, ",")
	ui, target := "en", "ko"
	if strings.HasPrefix(strings.ToLower(strings.TrimSpace(first)), "ko") {
		ui, target = "ko", "en"
	}
	ja := "ja"
	return Preferences{Source: "auto", Target: target, Mode: "casual", UILang: ui, RecentSource: &ja, RecentTarget: &ja}
}

// Parse validates the request cookie against rules, falling back to defaults.
func Parse(r *http.Request, rules contract.PrefRules) Snapshot {
	fallback := Snapshot{Preferences: Defaults(r.Header.Get("Accept-Language"))}
	c, err := r.Cookie(rules.Cookie)
	if err != nil {
		return fallback
	}
	raw, err := url.PathUnescape(c.Value)
	if err != nil || raw == "" || len(utf16.Encode([]rune(raw))) > rules.MaxCookieLength {
		return fallback
	}
	var obj map[string]any
	if err := json.Unmarshal([]byte(raw), &obj, jsontext.AllowDuplicateNames(true), jsontext.AllowInvalidUTF8(true)); err != nil {
		return fallback
	}
	if v, ok := obj["version"].(float64); !ok || v != float64(rules.Version) {
		return fallback
	}
	vals := map[string]*string{}
	for _, f := range rules.Fields {
		v, present := obj[f.Key]
		var s *string
		switch t := v.(type) {
		case string:
			s = &t
		case nil:
			if !present {
				return fallback
			}
		default:
			return fallback
		}
		if !slices.ContainsFunc(f.Values, func(a *string) bool { return equal(a, s) }) {
			return fallback
		}
		vals[f.Key] = s
	}
	return Snapshot{HasCookie: true, Preferences: Preferences{
		Source: *vals["source"], Target: *vals["target"], Mode: *vals["mode"], UILang: *vals["uiLang"],
		RecentSource: vals["recentSource"], RecentTarget: vals["recentTarget"],
	}}
}

func equal(a, b *string) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}

// Cookie builds the Set-Cookie for p. rules supply the cookie name, version,
// Max-Age and field order.
func Cookie(p Preferences, rules contract.PrefRules, secure bool) *http.Cookie {
	field := map[string]*string{
		"source": &p.Source, "target": &p.Target, "mode": &p.Mode, "uiLang": &p.UILang,
		"recentSource": p.RecentSource, "recentTarget": p.RecentTarget,
	}
	var b strings.Builder
	b.WriteString(`{"version":` + strconv.Itoa(rules.Version))
	for _, f := range rules.Fields {
		b.WriteString(",")
		k, _ := json.Marshal(f.Key)
		b.Write(k)
		b.WriteString(":")
		v, _ := json.Marshal(field[f.Key]) // nil pointer -> null
		b.Write(v)
	}
	b.WriteString("}")
	return &http.Cookie{
		Name: rules.Cookie, Value: encodeURIComponent(b.String()), Path: "/",
		MaxAge: rules.MaxAgeSeconds, SameSite: http.SameSiteLaxMode, Secure: secure,
	}
}

// encodeURIComponent reproduces the JavaScript function byte for byte
// (url.QueryEscape/PathEscape differ in the characters they keep).
func encodeURIComponent(s string) string {
	const hex = "0123456789ABCDEF"
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z', c >= '0' && c <= '9',
			strings.IndexByte("-_.!~*'()", c) >= 0:
			b.WriteByte(c)
		default:
			b.WriteByte('%')
			b.WriteByte(hex[c>>4])
			b.WriteByte(hex[c&15])
		}
	}
	return b.String()
}
