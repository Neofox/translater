// Command smoke sends ONE real request to a deployed Go app and prints its
// timings: a production smoke for POST /translate or POST /speech (the Go
// counterparts of scripts/smoke-translate.mjs and smoke-speech.mjs, but
// through the deployed HTTP endpoints instead of the provider SDK).
//
//	go run ./cmd/smoke -url https://example.vercel.app -translate
//	go run ./cmd/smoke -url https://example.vercel.app -speech
//
// Each invocation is one billed OpenAI request (unless the deployment's
// in-memory LRU already holds that translation). Nothing is retried. Output
// is timings, counts and header facts only: never the source text, the
// translation, partial HTML, audio or error bodies. A failure exits 1 with a
// content-free reason.
//
// Deployment Protection: the bypass secret comes from -bypass or, when that
// flag is empty, from $VERCEL_AUTOMATION_BYPASS_SECRET, and is sent as the
// x-vercel-protection-bypass header. The flag has no default so -h never
// prints the secret.
//
// Hand-written: a few stdlib HTTP requests and an SSE line reader; no
// maintained library measures per-event arrival times of a POST stream.
package main

import (
	"bufio"
	"context"
	"crypto/rand"
	"errors"
	"flag"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"os"
	"slices"
	"strconv"
	"strings"
	"time"
)

// The default sentences are synthetic, and differ from the browser smoke's
// (e2e/tests/prod-smoke.spec.ts) so one does not hit the LRU entry of the
// other on the same warm instance.
const (
	defaultTranslateText = "I'll grab dinner with my friend tonight."
	defaultSpeechText    = "안녕하세요. 만나서 반가워요."
)

// streamGap is the spacing that counts as a separate network arrival: a
// streamed response has at least minArrivals frames each more than
// streamGap after the previously counted one; a buffered (or LRU-cached)
// response arrives at once.
const (
	streamGap   = 50 * time.Millisecond
	minArrivals = 3
)

func main() {
	os.Exit(run(os.Args[1:], os.Getenv, os.Stdout, os.Stderr, http.DefaultTransport))
}

type options struct {
	base      *url.URL
	translate bool
	speech    bool
	text      string
	bypass    string
	timeout   time.Duration
}

func run(args []string, getenv func(string) string, stdout, stderr io.Writer, transport http.RoundTripper) int {
	fs := flag.NewFlagSet("smoke", flag.ContinueOnError)
	fs.SetOutput(stderr)
	rawURL := fs.String("url", "", "deployment base URL, e.g. https://translater-go.vercel.app")
	tr := fs.Bool("translate", false, "send one POST /translate (sentence, en→ko, casual)")
	sp := fs.Bool("speech", false, "send one POST /speech (ko)")
	text := fs.String("text", "", "synthetic input text (default: a fixed sentence); never printed")
	bypass := fs.String("bypass", "", "Vercel protection bypass secret (default: $VERCEL_AUTOMATION_BYPASS_SECRET)")
	timeout := fs.Duration("timeout", 120*time.Second, "whole-request timeout")
	if err := fs.Parse(args); err != nil {
		return 2
	}
	if *tr == *sp {
		fmt.Fprintln(stderr, "smoke: pass exactly one of -translate or -speech")
		return 2
	}
	base, err := url.Parse(strings.TrimRight(*rawURL, "/"))
	if err != nil || (base.Scheme != "http" && base.Scheme != "https") || base.Host == "" {
		fmt.Fprintln(stderr, "smoke: -url must be an http(s) base URL")
		return 2
	}
	o := options{base: base, translate: *tr, speech: *sp, text: *text, bypass: *bypass, timeout: *timeout}
	if o.bypass == "" {
		o.bypass = getenv("VERCEL_AUTOMATION_BYPASS_SECRET")
	}
	client := &http.Client{
		Transport: transport,
		// A redirect (http→https, a login page) would turn the POST into a
		// GET; report it instead.
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
	ctx, cancel := context.WithTimeout(context.Background(), o.timeout)
	defer cancel()

	fmt.Fprintf(stdout, "billed requests: 1 (%s)\n", map[bool]string{true: "translation", false: "speech"}[o.translate])
	if o.translate {
		err = smokeTranslate(ctx, client, o, stdout)
	} else {
		err = smokeSpeech(ctx, client, o, stdout)
	}
	if err != nil {
		fmt.Fprintf(stderr, "smoke: FAILED: %v\n", err)
		return 1
	}
	fmt.Fprintln(stdout, "smoke: OK")
	return 0
}

func newRequest(ctx context.Context, o options, path string, form url.Values) (*http.Request, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, o.base.String()+path, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, errors.New("could not build the request")
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	// Explicit, so the transport neither adds gzip nor silently undoes it:
	// a Content-Encoding the browser would also get must be visible here.
	req.Header.Set("Accept-Encoding", "gzip, deflate, br")
	if o.bypass != "" {
		req.Header.Set("x-vercel-protection-bypass", o.bypass)
	}
	return req, nil
}

// send performs req and fails on anything but 200. The body of a failure is
// never read (it may be an error message or a protection page).
func send(client *http.Client, req *http.Request) (*http.Response, error) {
	res, err := client.Do(req)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			return nil, errors.New("timed out before response headers")
		}
		return nil, errors.New("request failed before response headers (network/TLS)")
	}
	if res.StatusCode != http.StatusOK {
		res.Body.Close()
		hint := ""
		switch res.StatusCode {
		case http.StatusUnauthorized, http.StatusForbidden:
			hint = " (Deployment Protection? set VERCEL_AUTOMATION_BYPASS_SECRET)"
		case http.StatusMovedPermanently, http.StatusFound, http.StatusTemporaryRedirect, http.StatusPermanentRedirect:
			hint = " (redirect: use the final https base URL)"
		}
		return nil, fmt.Errorf("HTTP %d%s", res.StatusCode, hint)
	}
	return res, nil
}

func ms(d time.Duration) string { return strconv.FormatInt(d.Milliseconds(), 10) + " ms" }

func smokeTranslate(ctx context.Context, client *http.Client, o options, stdout io.Writer) error {
	text := o.text
	if text == "" {
		text = defaultTranslateText
	}
	form := url.Values{
		"run":     {newUUID()},
		"text":    {text},
		"source":  {"en"},
		"target":  {"ko"},
		"mode":    {"casual"},
		"intent":  {"sentence"},
		"uiLang":  {"en"},
		"trigger": {"force"},
	}
	req, err := newRequest(ctx, o, "/translate", form)
	if err != nil {
		return err
	}
	start := time.Now()
	res, err := send(client, req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	headers := time.Since(start)
	if mt, _, _ := mime.ParseMediaType(res.Header.Get("Content-Type")); mt != "text/event-stream" {
		return fmt.Errorf("Content-Type is %q, want text/event-stream", mt)
	}
	if ce := res.Header.Get("Content-Encoding"); ce != "" {
		return fmt.Errorf("response is Content-Encoding %q: a compressed event stream may be buffered", ce)
	}

	s, err := readEvents(res.Body, start)
	if err != nil {
		return err
	}
	fmt.Fprintf(stdout, "headers:        %s\n", ms(headers))
	if len(s.frames) > 0 {
		fmt.Fprintf(stdout, "first frame:    %s\n", ms(s.frames[0]))
	}
	for _, name := range []string{"nt-main-delta", "nt-main-ready", "nt-learning", "nt-done"} {
		if at, ok := s.first[name]; ok {
			fmt.Fprintf(stdout, "%-15s %s\n", name+":", ms(at))
		}
	}
	deltas := s.times["nt-main-delta"]
	fmt.Fprintf(stdout, "main deltas:    %d\n", len(deltas))
	if gaps := spacing(deltas); len(gaps) > 0 {
		fmt.Fprintf(stdout, "delta spacing:  min %s, median %s, max %s\n", ms(gaps[0]), ms(gaps[len(gaps)/2]), ms(gaps[len(gaps)-1]))
	}
	fmt.Fprintf(stdout, "text deltas:    %d\n", len(s.times["nt-text-delta"]))
	fmt.Fprintf(stdout, "html partials:  %d\n", s.partials)
	fmt.Fprintf(stdout, "frames:         %d over %s, %d arrivals >%s apart\n", len(s.frames), ms(s.span()), arrivals(s.frames), ms(streamGap))

	if n := len(s.times["nt-error"]); n > 0 {
		return fmt.Errorf("stream ended with nt-error (kind %q)", s.errorKind)
	}
	if len(s.times["nt-done"]) != 1 {
		return fmt.Errorf("want exactly one nt-done, got %d (stream cut short?)", len(s.times["nt-done"]))
	}
	if len(deltas) == 0 || len(s.times["nt-main-ready"]) != 1 {
		return fmt.Errorf("want main deltas and one nt-main-ready, got %d and %d", len(deltas), len(s.times["nt-main-ready"]))
	}
	if s.first["nt-main-ready"] >= s.first["nt-done"] {
		return errors.New("nt-main-ready did not arrive before nt-done")
	}
	if arrivals(s.frames) < minArrivals {
		return fmt.Errorf("all %d frames arrived within %s: the response was buffered, or the instance's LRU cache answered (retry with a fresh -text)", len(s.frames), ms(s.span()))
	}
	return nil
}

// events is what one SSE response contained: arrival times only, plus the
// error kind (an enum) of an nt-error.
type events struct {
	frames    []time.Duration
	first     map[string]time.Duration
	times     map[string][]time.Duration
	partials  int
	errorKind string
}

func (s events) span() time.Duration {
	if len(s.frames) == 0 {
		return 0
	}
	return s.frames[len(s.frames)-1] - s.frames[0]
}

// readEvents reads the event stream, timestamping each frame when its
// terminating blank line arrives. Lines are read with bufio.Reader (an
// <hx-partial> line can exceed bufio.Scanner's 64 KB limit). Data lines are
// inspected only for an nt-error's kind; nothing else is kept.
func readEvents(body io.Reader, start time.Time) (events, error) {
	s := events{first: map[string]time.Duration{}, times: map[string][]time.Duration{}}
	r := bufio.NewReaderSize(body, 64<<10)
	name, hasData := "", false
	var data strings.Builder
	for {
		line, err := r.ReadString('\n')
		if line != "" {
			line = strings.TrimRight(line, "\r\n")
			switch {
			case line == "":
				if hasData || name != "" {
					at := time.Since(start)
					s.frames = append(s.frames, at)
					if name == "" {
						s.partials++
					} else {
						if _, ok := s.first[name]; !ok {
							s.first[name] = at
						}
						s.times[name] = append(s.times[name], at)
						if name == "nt-error" {
							s.errorKind = errorKind(data.String())
						}
					}
				}
				name, hasData = "", false
				data.Reset()
			case strings.HasPrefix(line, "event:"):
				name = strings.TrimSpace(strings.TrimPrefix(line, "event:"))
			case strings.HasPrefix(line, "data:"):
				hasData = true
				if name == "nt-error" {
					data.WriteString(strings.TrimPrefix(line, "data:"))
				}
			}
		}
		if err == io.EOF {
			return s, nil
		}
		if err != nil {
			if errors.Is(err, context.DeadlineExceeded) {
				return s, fmt.Errorf("timed out after %d frames", len(s.frames))
			}
			return s, fmt.Errorf("stream read failed after %d frames", len(s.frames))
		}
	}
}

// errorKind extracts "kind" from an nt-error payload, accepting only a
// short lowercase enum so the localized message never leaks into output.
func errorKind(payload string) string {
	const key = `"kind":"`
	i := strings.Index(payload, key)
	if i < 0 {
		return "unknown"
	}
	rest := payload[i+len(key):]
	j := strings.IndexByte(rest, '"')
	if j < 0 || j > 32 || strings.ContainsFunc(rest[:j], func(r rune) bool { return (r < 'a' || r > 'z') && r != '_' }) {
		return "unknown"
	}
	return rest[:j]
}

// spacing returns the sorted gaps between consecutive arrival times.
func spacing(times []time.Duration) []time.Duration {
	if len(times) < 2 {
		return nil
	}
	gaps := make([]time.Duration, 0, len(times)-1)
	for i := 1; i < len(times); i++ {
		gaps = append(gaps, times[i]-times[i-1])
	}
	slices.Sort(gaps)
	return gaps
}

// arrivals counts frames each more than streamGap after the previously
// counted one (the first frame counts).
func arrivals(times []time.Duration) int {
	n := 0
	var last time.Duration
	for i, t := range times {
		if i == 0 || t-last > streamGap {
			n++
			last = t
		}
	}
	return n
}

func smokeSpeech(ctx context.Context, client *http.Client, o options, stdout io.Writer) error {
	text := o.text
	if text == "" {
		text = defaultSpeechText
	}
	form := url.Values{"text": {text}, "language": {"ko"}, "uiLang": {"en"}}
	req, err := newRequest(ctx, o, "/speech", form)
	if err != nil {
		return err
	}
	start := time.Now()
	res, err := send(client, req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	headers := time.Since(start)
	mt, params, _ := mime.ParseMediaType(res.Header.Get("Content-Type"))
	if !strings.EqualFold(mt, "audio/L16") {
		return fmt.Errorf("Content-Type is %q, want audio/L16", mt)
	}
	rate, err := strconv.Atoi(params["rate"])
	if err != nil || rate < 8000 || rate > 48000 {
		return errors.New("audio/L16 rate parameter missing or outside 8000–48000 Hz")
	}
	if params["channels"] != "1" {
		return errors.New("audio/L16 is not mono (channels=1)")
	}
	ce := res.Header.Get("Content-Encoding")
	declared := res.ContentLength // -1 when absent (chunked)

	var firstByte time.Duration
	var n int64
	buf := make([]byte, 32<<10)
	for {
		k, rerr := res.Body.Read(buf)
		if k > 0 && n == 0 {
			firstByte = time.Since(start)
		}
		n += int64(k)
		if rerr == io.EOF {
			break
		}
		if rerr != nil {
			return fmt.Errorf("audio read failed after %d bytes (truncated?)", n)
		}
	}
	done := time.Since(start)

	fmt.Fprintf(stdout, "headers:        %s\n", ms(headers))
	fmt.Fprintf(stdout, "first byte:     %s\n", ms(firstByte))
	fmt.Fprintf(stdout, "done:           %s\n", ms(done))
	fmt.Fprintf(stdout, "bytes:          %d\n", n)
	fmt.Fprintf(stdout, "sample rate:    %d Hz\n", rate)
	fmt.Fprintf(stdout, "audio:          %.2f s\n", float64(n)/float64(rate*2))
	if declared >= 0 {
		fmt.Fprintf(stdout, "Content-Length: present (%d)\n", declared)
	} else {
		fmt.Fprintln(stdout, "Content-Length: absent (truncation is detected only by the platform's stream error)")
	}
	if ce != "" {
		fmt.Fprintf(stdout, "Content-Encoding: %s\n", ce)
	}

	// A Content-Encoding (the browser decodes it) leaves n the encoded size.
	if n == 0 || (ce == "" && n%2 != 0) {
		return fmt.Errorf("want a nonempty, even number of PCM16 bytes, got %d", n)
	}
	if declared >= 0 && declared != n {
		return fmt.Errorf("Content-Length %d but %d bytes arrived", declared, n)
	}
	return nil
}

// newUUID is a random RFC 9562 version-4 UUID (the run id the page sends).
func newUUID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}
