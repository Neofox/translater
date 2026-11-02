package web

import (
	"encoding/json/v2"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"

	assets "neotranslate/web"
)

func newStatic(t *testing.T) *Static {
	t.Helper()
	s, err := NewStatic(assets.FS)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func get(h http.Handler, path string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
	return rec
}

func TestStaticHashedImmutable(t *testing.T) {
	s := newStatic(t)
	url := s.URL("js/app.js")
	if !regexp.MustCompile(`^/static/js/app\.[0-9a-f]{10}\.js$`).MatchString(url) {
		t.Fatalf("URL = %q", url)
	}
	rec := get(s, url)
	if rec.Code != http.StatusOK || rec.Header().Get("Cache-Control") != "public, max-age=31536000, immutable" ||
		!strings.HasPrefix(rec.Header().Get("Content-Type"), "text/javascript") {
		t.Fatalf("GET %s: %d %v", url, rec.Code, rec.Header())
	}
	for _, path := range []string{"/static/js/app.js", "/static/js/", "/static/", "/static/js/composer.test.js", "/static/css/input.css", "/static/css/base.css"} {
		if rec := get(s, path); rec.Code != http.StatusNotFound {
			t.Errorf("GET %s = %d, want 404", path, rec.Code)
		}
	}
}

func TestStaticModulesMinifiedAndMapped(t *testing.T) {
	s := newStatic(t)
	var m struct {
		Imports map[string]string `json:"imports"`
	}
	if err := json.Unmarshal([]byte(s.ImportMap()), &m); err != nil {
		t.Fatal(err)
	}
	names := []string{"app", "composer", "copy", "prefs", "stream"}
	if len(m.Imports) != len(names) {
		t.Fatalf("import map = %v", m.Imports)
	}
	for _, n := range names {
		url := m.Imports["/static/js/"+n+".js"]
		if url != s.URL("js/"+n+".js") {
			t.Errorf("%s maps to %q", n, url)
		}
	}
	app := s.byName["js/app.js"].Body
	if strings.Contains(string(app), "// ") || !strings.Contains(string(app), "./composer.js") {
		t.Errorf("app.js not minified or lost its imports: %.200s", app)
	}
	if got := len(s.Scripts()); got != 7 {
		t.Errorf("Scripts() = %d files, want htmx, hx-sse and 5 modules", got)
	}
}
