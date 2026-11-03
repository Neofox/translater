package web

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"neotranslate/internal/contract"
	"neotranslate/internal/prefs"
)

func newPages(t *testing.T) (*Pages, *contract.Contract) {
	t.Helper()
	c, err := contract.Load()
	if err != nil {
		t.Fatal(err)
	}
	return NewPages(c, newStatic(t)), c
}

func sp(s string) *string { return &s }

func TestPageRendersFromCookie(t *testing.T) {
	p, c := newPages(t)
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	saved := prefs.Preferences{Source: "auto", Target: "fr", Mode: "professional", UILang: "ko", RecentSource: nil, RecentTarget: sp("fr")}
	req.AddCookie(prefs.Cookie(saved, c.Prefs, false))
	rec := httptest.NewRecorder()
	p.HandlePage(rec, req)
	body := rec.Body.String()
	if rec.Code != 200 || rec.Header().Get("Cache-Control") != "private, no-store" || rec.Header().Get("Vary") != "Cookie, Accept-Language" {
		t.Fatalf("GET / = %d %v", rec.Code, rec.Header())
	}
	for _, want := range []string{
		`<html lang="ko"`,
		`aria-label="말투"`,
		`aria-pressed="true" data-t="modeProfessional"`,
		`<option value="professional" selected`,
		`aria-pressed="true" data-testid="lang-chip" data-value="fr"`,
		`aria-label="UI language"`,
		`aria-pressed="true" class="cursor-pointer rounded px-2 py-0.5 font-semibold tracking-wide transition bg-accent text-bg shadow-sm">한<`,
		`data-testid="input-textarea"`,
		`placeholder="입력하거나 붙여넣으세요"`,
		`"prefs":{"mode":"professional","recentSource":null,"recentTarget":"fr","source":"auto","target":"fr","uiLang":"ko"}`,
		`<script defer src="/_vercel/insights/script.js"></script></head>`,
		`<input type="hidden" name="analyticsSessionId"><input type="hidden" name="supersedesRunId"><input type="hidden" name="inputRevision"><input type="hidden" name="trigger"></form>`,
	} {
		if !strings.Contains(body, want) {
			t.Errorf("page lacks %s", want)
		}
	}
	// The textarea is in no form (runs copy its text into #translate-form).
	if strings.Contains(body, `name="text"></textarea>`) || strings.Contains(body, `<textarea name`) {
		t.Error("textarea must not be a form field")
	}
	// The target bar shows en, ko and the selected recent fr; the source bar
	// has no recent chip (null).
	if n := strings.Count(body, `data-testid="lang-chip"`); n != 3+3 {
		t.Errorf("%d chips, want 3 source + 3 target", n)
	}
	if strings.Contains(body, `data-value="ja"`) {
		t.Error("ja is not a chip any more")
	}
}

func TestPageDefaultsFromAcceptLanguage(t *testing.T) {
	p, _ := newPages(t)
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Accept-Language", "ko-KR,ko;q=0.9")
	rec := httptest.NewRecorder()
	p.HandlePage(rec, req)
	body := rec.Body.String()
	if !strings.Contains(body, `<html lang="ko"`) || !strings.Contains(body, `aria-pressed="true" data-testid="lang-chip" data-value="en"`) {
		t.Error("Korean browsers default to UI ko, target en")
	}
}

func TestPrefsPartials(t *testing.T) {
	p, _ := newPages(t)
	form := url.Values{"source": {"es"}, "target": {"ko"}, "mode": {"casual"}, "uiLang": {"en"}, "recentSource": {"es"}, "recentTarget": {"fr"}}
	req := httptest.NewRequest(http.MethodPost, "/prefs", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rec := httptest.NewRecorder()
	p.HandlePrefs(rec, req)
	body := rec.Body.String()
	if rec.Code != 200 || rec.Header().Get("Cache-Control") != "private, no-store" {
		t.Fatalf("POST /prefs = %d", rec.Code)
	}
	for _, want := range []string{
		`<hx-partial hx-target="#source-bar" hx-swap="outerMorph">`,
		`<hx-partial hx-target="#target-bar" hx-swap="outerMorph">`,
		`aria-pressed="true" data-testid="lang-chip" data-value="es"`,
		`aria-pressed="false" data-testid="lang-chip" data-value="fr"`,
	} {
		if !strings.Contains(body, want) {
			t.Errorf("partials lack %s", want)
		}
	}
	if strings.Contains(body, "textarea") {
		t.Error("prefs partials must never contain the textarea")
	}
	form.Set("target", "auto")
	req = httptest.NewRequest(http.MethodPost, "/prefs", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rec = httptest.NewRecorder()
	p.HandlePrefs(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("invalid prefs = %d, want 400", rec.Code)
	}
}

func TestPageNotFound(t *testing.T) {
	p, _ := newPages(t)
	rec := httptest.NewRecorder()
	p.HandlePage(rec, httptest.NewRequest(http.MethodGet, "/nope", nil))
	if rec.Code != http.StatusNotFound {
		t.Errorf("GET /nope = %d", rec.Code)
	}
}
