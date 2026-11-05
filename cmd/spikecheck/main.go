// spikecheck runs the Vercel Go streaming spike checks against -url.
package main

import (
	"bufio"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

type stats struct {
	Instance     string `json:"instance"`
	Served       int64  `json:"served"`
	LastCancelAt int64  `json:"lastCancelAt"`
	BootAt       int64  `json:"bootAt"`
	Now          int64  `json:"now"` // server clock at response time
}

// bypassTransport adds the Vercel deployment-protection bypass header when
// VERCEL_AUTOMATION_BYPASS_SECRET is set.
type bypassTransport struct{}

func (bypassTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	if sec := os.Getenv("VERCEL_AUTOMATION_BYPASS_SECRET"); sec != "" {
		r = r.Clone(r.Context())
		r.Header.Set("x-vercel-protection-bypass", sec)
	}
	return http.DefaultTransport.RoundTrip(r)
}

var client = &http.Client{Transport: bypassTransport{}}

func report(name string, ok bool, detail string) bool {
	s := "FAIL"
	if ok {
		s = "PASS"
	}
	fmt.Printf("%s  %s  %s\n", s, name, detail)
	return ok
}

func getStats(base string) (stats, error) {
	var s stats
	resp, err := client.Get(base + "/spike/stats")
	if err != nil {
		return s, err
	}
	defer resp.Body.Close()
	return s, json.NewDecoder(resp.Body).Decode(&s)
}

// incremental counts events arriving >=50ms after the previous one.
func incremental(method, base string) (spaced, total int, ttfb, headers time.Duration, err error) {
	start := time.Now()
	req, _ := http.NewRequest(method, base+"/spike/stream?n=50&ms=100", nil)
	resp, err := client.Do(req)
	if err != nil {
		return
	}
	defer resp.Body.Close()
	headers = time.Since(start)
	sc := bufio.NewScanner(resp.Body)
	var prev time.Time
	for sc.Scan() {
		if !strings.HasPrefix(sc.Text(), "data: ") {
			continue
		}
		now := time.Now()
		if total == 0 {
			ttfb = now.Sub(start)
		} else if now.Sub(prev) >= 50*time.Millisecond {
			spaced++
		}
		prev = now
		total++
	}
	return spaced, total, ttfb, headers, sc.Err()
}

// cancellation measures on ONE clock per side, never across machines: the
// server reports "now" with lastCancelAt, so serverAgo = now-lastCancelAt is
// pure server time, and the client measures time since it closed the stream.
// Estimated latency = clientElapsed - serverAgo (time from close until the
// server noticed); upper bound = clientElapsed at first observation. The
// stats poll must hit the instance that served the stream (X-Instance).
func cancellation(base string) bool {
	ctx, cancel := context.WithCancel(context.Background())
	req, _ := http.NewRequestWithContext(ctx, "GET", base+"/spike/stream?n=50&ms=100", nil)
	resp, err := client.Do(req)
	if err != nil {
		cancel()
		return report("2 cancellation", false, err.Error())
	}
	inst := resp.Header.Get("X-Instance")
	if inst == "" {
		cancel()
		return report("2 cancellation", false, "no X-Instance header on stream response")
	}
	go io.Copy(io.Discard, resp.Body)
	time.Sleep(1 * time.Second)
	closedAt := time.Now()
	cancel()
	matched := false
	var s stats
	for try := 1; try <= 20; try++ {
		time.Sleep(100 * time.Millisecond)
		elapsed := time.Since(closedAt)
		var err error
		s, err = getStats(base)
		if err != nil || s.Instance != inst {
			continue
		}
		matched = true
		serverAgo := time.Duration(s.Now-s.LastCancelAt) * time.Millisecond
		if s.LastCancelAt == 0 || serverAgo > elapsed+100*time.Millisecond {
			continue // not cancelled yet (or a cancel older than this close)
		}
		upper := time.Since(closedAt)
		est := upper - serverAgo
		return report("2 cancellation", upper <= 1500*time.Millisecond,
			fmt.Sprintf("instance=%s try=%d estimated latency=%dms upper bound=%dms (need <=1500)", inst, try, est.Milliseconds(), upper.Milliseconds()))
	}
	if !matched {
		return report("2 cancellation INCONCLUSIVE", false,
			fmt.Sprintf("stats never came from stream instance %s in 20 polls (last instance %s)", inst, s.Instance))
	}
	return report("2 cancellation", false, "stream instance reached but lastCancelAt never updated within ~2s of close")
}

func reuse(base string) bool {
	ids := map[string]bool{}
	var first, last int64
	for i := 0; i < 5; i++ {
		s, err := getStats(base)
		if err != nil {
			return report("3 reuse", false, err.Error())
		}
		ids[s.Instance] = true
		if i == 0 {
			first = s.Served
		}
		last = s.Served
	}
	return report("3 reuse (informational)", true,
		fmt.Sprintf("distinct instances=%d served first=%d last=%d", len(ids), first, last))
}

func main() {
	url := flag.String("url", "http://localhost:3000", "base URL")
	only := flag.String("only", "", "run only: cold")
	flag.Parse()
	base := strings.TrimRight(*url, "/")

	if *only == "cold" {
		sp, tot, ttfb, hdr, err := incremental("GET", base)
		if !report("4 cold TTFB (first request after >=15min idle)", err == nil && ttfb < 500*time.Millisecond,
			fmt.Sprintf("time-to-headers=%dms ttfb(first event)=%dms spaced=%d/%d err=%v target<500ms", hdr.Milliseconds(), ttfb.Milliseconds(), sp, tot, err)) {
			os.Exit(1)
		}
		return
	}

	ok := true
	sp, tot, ttfb, _, err := incremental("GET", base)
	ok = report("1 incremental GET", err == nil && tot == 50 && sp >= 40,
		fmt.Sprintf("spaced>=50ms: %d/%d events (need >=40) ttfb=%dms err=%v", sp, tot, ttfb.Milliseconds(), err)) && ok
	ok = cancellation(base) && ok
	ok = reuse(base) && ok
	sp, tot, ttfb, _, err = incremental("POST", base)
	ok = report("5 incremental POST", err == nil && tot == 50 && sp >= 40,
		fmt.Sprintf("spaced>=50ms: %d/%d events (need >=40) ttfb=%dms err=%v", sp, tot, ttfb.Milliseconds(), err)) && ok
	fmt.Println("(check 4 cold TTFB: run with `-only cold` after >=15 min idle)")
	if !ok {
		os.Exit(1)
	}
}
