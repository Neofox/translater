// Package assets embeds the browser files served under /static/. It lives
// next to static/ because go:embed cannot reach parent directories; serving
// and hashing are in internal/web.
package assets

import "embed"

// FS holds the served files. Unit tests (*.test.js) and the Tailwind inputs
// are embedded by the patterns but never served (internal/web skips them).
//
//go:embed static/vendor/*.js static/js/*.js static/css/app.css static/favicon.svg
var FS embed.FS
