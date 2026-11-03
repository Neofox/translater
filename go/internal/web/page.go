// Package web renders the translator page (templ) and serves its static
// assets. GET / renders the whole document from the nt.preferences cookie,
// so the first paint is final; POST /prefs re-renders the language chip
// bars for changed preferences.
package web

import (
	"encoding/json/jsontext"
	"encoding/json/v2"
	"net/http"
	"strconv"
	"strings"

	"github.com/a-h/templ"

	"neotranslate/internal/contract"
	"neotranslate/internal/prefs"
)

// clientStrings are the UI strings the client modules use: [data-t] labels
// (relabelled on a UI-language switch) and messages built in JavaScript.
var clientStrings = []string{
	"tone", "modeFriends", "modeCasual", "modeProfessional", "settings",
	"sourceText", "translation", "placeholder", "inputText", "paste", "pasteClipboard",
	"clear", "clearInput", "clearInputTitle", "copy", "copied", "listen", "swapLanguages",
	"streaming", "emptyMain", "inputCount", "charCount", "whyWording", "usage",
	"translationFailedTitle", "translationFailed", "inputTooLong", "inputTooLongHint",
	"contextToggle", "contextShort", "contextPlaceholder", "contextClear",
}

// Pages renders the document and the preference partials.
type Pages struct {
	c      *contract.Contract
	static *Static
	data   map[string]any // client data without the per-request prefs
}

// NewPages prepares the request-independent client data.
func NewPages(c *contract.Contract, static *Static) *Pages {
	strs := map[string]map[string]string{}
	for _, ui := range []string{"en", "ko"} {
		strs[ui] = map[string]string{}
		for _, key := range clientStrings {
			strs[ui][key] = c.T(ui, key)
		}
	}
	langs := make([]map[string]string, len(c.Languages))
	for i, l := range c.Languages {
		langs[i] = map[string]string{"code": l.Code, "label": l.Label}
	}
	fields := make([]string, len(c.Prefs.Fields))
	for i, f := range c.Prefs.Fields {
		fields[i] = f.Key
	}
	return &Pages{c: c, static: static, data: map[string]any{
		"strings":   strs,
		"languages": langs,
		"limits":    map[string]any{"maxInputChars": c.Limits.MaxInputChars, "inputWarnFraction": c.Limits.InputWarnFraction},
		"rules":     map[string]any{"cookie": c.Prefs.Cookie, "version": c.Prefs.Version, "maxAge": c.Prefs.MaxAgeSeconds, "fields": fields},
	}}
}

func (p *Pages) view(pr prefs.Preferences) View {
	return View{Prefs: pr, Contract: p.c, Static: p.static}
}

// HandlePage is GET /: the full page for the request's preferences.
func (p *Pages) HandlePage(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}
	v := p.view(prefs.Parse(r, p.c.Prefs).Preferences)
	data := map[string]any{"prefs": clientPrefs(v.Prefs)}
	for k, val := range p.data {
		data[k] = val
	}
	b, err := json.Marshal(data, json.Deterministic(true), jsontext.EscapeForHTML(true))
	if err != nil {
		http.Error(w, "page data", http.StatusInternalServerError)
		return
	}
	v.Data = string(b)
	render(w, r, Page(v))
}

// HandlePrefs is POST /prefs: both chip bars for the posted preferences
// (the client already wrote the cookie).
func (p *Pages) HandlePrefs(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 4<<10)
	if err := r.ParseForm(); err != nil {
		http.Error(w, "invalid preferences", http.StatusBadRequest)
		return
	}
	pr, ok := prefs.FromValues(r.PostForm.Get, p.c.Prefs)
	if !ok {
		http.Error(w, "invalid preferences", http.StatusBadRequest)
		return
	}
	render(w, r, Bars(p.view(pr)))
}

func render(w http.ResponseWriter, r *http.Request, c templ.Component) {
	h := w.Header()
	h.Set("Content-Type", "text/html; charset=utf-8")
	h.Set("Cache-Control", "private, no-store")
	h.Set("Vary", "Cookie, Accept-Language")
	if err := c.Render(r.Context(), w); err != nil {
		// Headers are gone; nothing useful to tell the client.
		return
	}
}

func clientPrefs(pr prefs.Preferences) map[string]any {
	return map[string]any{
		"source": pr.Source, "target": pr.Target, "mode": pr.Mode, "uiLang": pr.UILang,
		"recentSource": pr.RecentSource, "recentTarget": pr.RecentTarget,
	}
}

// inputCount is the empty editor's count label.
func (v View) inputCount() string {
	return strings.ReplaceAll(v.T("inputCount"), "{count}", strconv.Itoa(0))
}

// jsonScript writes a script element around JSON that was marshalled with
// HTML escaping (no "</script" can occur).
func jsonScript(attrs, body string) templ.Component {
	return templ.Raw("<script " + attrs + ">" + body + "</script>")
}
