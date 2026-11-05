package prefs

import (
	"net/http"
	"net/url"
	"strings"
	"testing"

	"neotranslate/internal/contract"
)

func rules(t *testing.T) contract.PrefRules {
	t.Helper()
	c, err := contract.Load()
	if err != nil {
		t.Fatal(err)
	}
	return c.Prefs
}

func sp(s string) *string { return &s }

var saved = Preferences{Source: "ko", Target: "fr", Mode: "professional", UILang: "ko", RecentSource: sp("zh"), RecentTarget: sp("fr")}

// The browser-side encoding of `saved` (as written by prefs.js and, before it,
// the original TypeScript app), computed by hand:
// encodeURIComponent(JSON.stringify({version:1,
// source,target,mode,uiLang,recentSource,recentTarget})).
const tsValue = "%7B%22version%22%3A1%2C%22source%22%3A%22ko%22%2C%22target%22%3A%22fr%22%2C%22mode%22%3A%22professional%22%2C%22uiLang%22%3A%22ko%22%2C%22recentSource%22%3A%22zh%22%2C%22recentTarget%22%3A%22fr%22%7D"
const tsHeader = "nt.preferences=" + tsValue + "; Path=/; Max-Age=31536000; SameSite=Lax; Secure"

func req(cookie, lang string) *http.Request {
	r, _ := http.NewRequest("GET", "/", nil)
	if cookie != "" {
		r.Header.Set("Cookie", "nt.preferences="+cookie)
	}
	if lang != "" {
		r.Header.Set("Accept-Language", lang)
	}
	return r
}

func TestReadsTSWrittenCookie(t *testing.T) {
	r, _ := http.NewRequest("GET", "/", nil)
	c, err := http.ParseSetCookie(tsHeader)
	if err != nil {
		t.Fatal(err)
	}
	r.AddCookie(&http.Cookie{Name: c.Name, Value: c.Value})
	got := Parse(r, rules(t))
	if !got.HasCookie || got.Preferences.Source != "ko" || got.Preferences.Target != "fr" ||
		got.Preferences.Mode != "professional" || got.Preferences.UILang != "ko" ||
		*got.Preferences.RecentSource != "zh" || *got.Preferences.RecentTarget != "fr" {
		t.Fatalf("got %+v", got)
	}
}

func TestWritesTSIdenticalCookie(t *testing.T) {
	c := Cookie(saved, rules(t), true)
	if c.Value != tsValue {
		t.Fatalf("value\n got %s\nwant %s", c.Value, tsValue)
	}
	h := c.String()
	for _, part := range []string{"nt.preferences=" + tsValue, "Path=/", "Max-Age=31536000", "SameSite=Lax", "Secure"} {
		if !strings.Contains(h, part) {
			t.Errorf("%q missing %q", h, part)
		}
	}
	if strings.Contains(Cookie(saved, rules(t), false).String(), "Secure") {
		t.Error("Secure set when not requested")
	}
}

func TestNullRecentRoundTrip(t *testing.T) {
	p := saved
	p.RecentSource = nil
	c := Cookie(p, rules(t), false)
	if !strings.Contains(c.Value, "%22recentSource%22%3Anull") {
		t.Fatalf("value %s", c.Value)
	}
	r := req(c.Value, "")
	got := Parse(r, rules(t))
	if !got.HasCookie || got.Preferences.RecentSource != nil || got.Preferences.Source != "ko" {
		t.Fatalf("got %+v", got)
	}
}

func TestIgnoresExtraFields(t *testing.T) {
	raw := `{"version":1,"source":"ko","target":"fr","mode":"professional","uiLang":"ko","recentSource":"zh","recentTarget":"fr","input":"private draft","context":"private reply"}`
	got := Parse(req(url.PathEscape(raw), "en-US"), rules(t))
	if !got.HasCookie || got.Preferences != Preferences(got.Preferences) || got.Preferences.Source != "ko" {
		t.Fatalf("got %+v", got)
	}
	if strings.Contains(Cookie(got.Preferences, rules(t), true).Value, "private") {
		t.Fatal("extra fields written back")
	}
}

func TestMalformedFallsBackToDefaults(t *testing.T) {
	good := `"source":"ko","target":"fr","mode":"professional","uiLang":"ko","recentSource":"zh","recentTarget":"fr"`
	for _, raw := range []string{
		"broken",
		"null",
		`{"version":2}`,
		`{"version":"1",` + good + `}`,
		`{"version":1,"source":"ko","target":"auto","mode":"professional","uiLang":"ko","recentSource":"zh","recentTarget":"fr"}`,
		`{"version":1,"source":"ko","target":"fr","mode":"injected","uiLang":"ko","recentSource":"zh","recentTarget":"fr"}`,
		`{"version":1,"source":"ko","target":"fr","mode":"professional","uiLang":"ko","recentSource":"zh"}`,                     // missing key
		`{"version":1,"source":null,"target":"fr","mode":"professional","uiLang":"ko","recentSource":"zh","recentTarget":"fr"}`, // null not allowed for source
		`{"version":1,"source":"ko","target":"fr","mode":"professional","uiLang":"ko","recentSource":5,"recentTarget":"fr"}`,
		`{"version":1,` + good + `,"pad":"` + strings.Repeat("x", 1100) + `"}`, // over max length
	} {
		got := Parse(req(url.PathEscape(raw), "ko-KR,ko;q=0.9"), rules(t))
		want := Defaults("ko-KR,ko;q=0.9")
		if got.HasCookie || got.Preferences.UILang != "ko" || got.Preferences.Target != want.Target {
			t.Errorf("%.60s: got %+v", raw, got)
		}
	}
}

func TestNoCookieAndDefaults(t *testing.T) {
	got := Parse(req("", "ko-KR,ko;q=0.9"), rules(t))
	if got.HasCookie || got.Preferences.Target != "en" || got.Preferences.UILang != "ko" {
		t.Fatalf("got %+v", got)
	}
	for _, c := range []struct{ lang, ui, target string }{
		{"ko-KR,ko;q=0.9", "ko", "en"},
		{"en-US,en;q=0.9,ko;q=0.8", "en", "ko"},
		{"", "en", "ko"},
		{" KO", "ko", "en"},
	} {
		d := Defaults(c.lang)
		if d.UILang != c.ui || d.Target != c.target || d.Source != "auto" || d.Mode != "casual" || *d.RecentSource != "ja" || *d.RecentTarget != "ja" {
			t.Errorf("Defaults(%q) = %+v", c.lang, d)
		}
	}
}

func TestFromValues(t *testing.T) {
	r := rules(t)
	form := url.Values{"source": {"ko"}, "target": {"fr"}, "mode": {"professional"}, "uiLang": {"ko"}, "recentSource": {"zh"}, "recentTarget": {"fr"}}
	got, ok := FromValues(form.Get, r)
	if !ok || got.Source != "ko" || got.Target != "fr" || *got.RecentSource != "zh" || *got.RecentTarget != "fr" {
		t.Fatalf("FromValues = %+v, %v", got, ok)
	}
	form.Set("recentSource", "")
	if got, ok := FromValues(form.Get, r); !ok || got.RecentSource != nil {
		t.Fatalf("empty recent should be null: %+v, %v", got, ok)
	}
	for _, bad := range []struct{ key, value string }{{"source", ""}, {"target", "auto"}, {"mode", "rude"}, {"uiLang", "fr"}, {"recentTarget", "xx"}} {
		f := url.Values{}
		for k, v := range form {
			f[k] = v
		}
		f.Set(bad.key, bad.value)
		if _, ok := FromValues(f.Get, r); ok {
			t.Errorf("%s=%q accepted", bad.key, bad.value)
		}
	}
}
