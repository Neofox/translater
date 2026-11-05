package web

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json/v2"
	"fmt"
	"io/fs"
	"mime"
	"net/http"
	"path"
	"slices"
	"strconv"
	"strings"

	"github.com/tdewolff/minify/v2"
	"github.com/tdewolff/minify/v2/js"
)

// Static serves embedded files at content-hashed URLs
// (/static/js/app.<hash>.js) with immutable caching. Only the exact hashed
// URL of a known file is served: no directory listing, no unhashed aliases.
//
// Hand-written: a map lookup over embed.FS. ES modules import each other by
// their unhashed paths; ImportMap maps those to the hashed URLs. The
// application modules are minified once at startup (tdewolff/minify): that
// saves more than 10% of the page's gzipped script bytes.
type Static struct {
	byName map[string]*File // "js/app.js" -> file
	byURL  map[string]*File // "/static/js/app.<hash>.js" -> file
}

// File is one served asset.
type File struct {
	Name        string // path below static/, e.g. "js/app.js"
	URL         string
	ContentType string
	Body        []byte
}

// NewStatic hashes every servable file of fsys (rooted at the static/
// directory's parent, as web/assets.FS is).
func NewStatic(fsys fs.FS) (*Static, error) {
	s := &Static{byName: map[string]*File{}, byURL: map[string]*File{}}
	m := minify.New()
	m.AddFunc("js", js.Minify)
	err := fs.WalkDir(fsys, "static", func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || strings.HasSuffix(p, ".test.js") {
			return err
		}
		body, err := fs.ReadFile(fsys, p)
		if err != nil {
			return err
		}
		name := strings.TrimPrefix(p, "static/")
		if strings.HasPrefix(name, "js/") {
			if body, err = m.Bytes("js", body); err != nil {
				return fmt.Errorf("minify %s: %w", name, err)
			}
		}
		sum := sha256.Sum256(body)
		ext := path.Ext(name)
		f := &File{
			Name:        name,
			URL:         "/static/" + strings.TrimSuffix(name, ext) + "." + hex.EncodeToString(sum[:5]) + ext,
			ContentType: mime.TypeByExtension(ext),
			Body:        body,
		}
		if ext == ".js" {
			f.ContentType = "text/javascript; charset=utf-8"
		}
		s.byName[name], s.byURL[f.URL] = f, f
		return nil
	})
	return s, err
}

// URL returns the hashed URL of name ("js/app.js"). An unknown name is a
// build defect and panics.
func (s *Static) URL(name string) string {
	f, ok := s.byName[name]
	if !ok {
		panic(fmt.Sprintf("web: unknown static asset %q", name))
	}
	return f.URL
}

// File is the served file for name ("css/app.css"), or nil.
func (s *Static) File(name string) *File { return s.byName[name] }

// Modules lists the application ES modules (js/*.js), sorted by name.
func (s *Static) Modules() []*File {
	var out []*File
	for name, f := range s.byName {
		if strings.HasPrefix(name, "js/") {
			out = append(out, f)
		}
	}
	slices.SortFunc(out, func(a, b *File) int { return strings.Compare(a.Name, b.Name) })
	return out
}

// Scripts lists every JavaScript file the page loads: htmx, its SSE
// extension and the application modules.
func (s *Static) Scripts() []*File {
	return append([]*File{s.byName["vendor/htmx.min.js"], s.byName["vendor/hx-sse.min.js"]}, s.Modules()...)
}

// ImportMap is the JSON import map from unhashed module URLs to hashed ones.
func (s *Static) ImportMap() string {
	imports := map[string]string{}
	for _, f := range s.Modules() {
		imports["/static/"+f.Name] = f.URL
	}
	b, err := json.Marshal(map[string]any{"imports": imports}, json.Deterministic(true))
	if err != nil {
		panic(err)
	}
	return string(b)
}

func (s *Static) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f, ok := s.byURL[r.URL.Path]
	if !ok {
		http.NotFound(w, r)
		return
	}
	h := w.Header()
	h.Set("Content-Type", f.ContentType)
	h.Set("Cache-Control", "public, max-age=31536000, immutable")
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Content-Length", strconv.Itoa(len(f.Body)))
	if r.Method != http.MethodHead {
		_, _ = w.Write(f.Body)
	}
}
