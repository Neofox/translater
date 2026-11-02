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
}

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
	resp, err := http.Get(base + "/spike/stats")
	if err != nil {
		return s, err
	}
	defer resp.Body.Close()
	return s, json.NewDecoder(resp.Body).Decode(&s)
}

// incremental counts events arriving >=50ms after the previous one.
func incremental(method, base string) (spaced, total int, ttfb time.Duration, err error) {
	start := time.Now()
	req, _ := http.NewRequest(method, base+"/spike/stream?n=50&ms=100", nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return
	}
	defer resp.Body.Close()
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
	return spaced, total, ttfb, sc.Err()
}

func cancellation(base string) bool {
	before, _ := getStats(base)
	ctx, cancel := context.WithCancel(context.Background())
	req, _ := http.NewRequestWithContext(ctx, "GET", base+"/spike/stream?n=50&ms=100", nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		cancel()
		return report("2 cancellation", false, err.Error())
	}
	go io.Copy(io.Discard, resp.Body)
	time.Sleep(1 * time.Second)
	closeAt := time.Now().UnixMilli()
	cancel()
	var s stats
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		time.Sleep(100 * time.Millisecond)
		s, _ = getStats(base)
		if s.LastCancelAt != before.LastCancelAt {
			break
		}
	}
	delta := s.LastCancelAt - closeAt
	return report("2 cancellation", s.LastCancelAt != before.LastCancelAt && delta >= -50 && delta <= 1500,
		fmt.Sprintf("lastCancelAt-closeAt=%dms (need <=1500) same-instance=%v", delta, s.Instance == before.Instance))
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
		sp, tot, ttfb, err := incremental("GET", base)
		if !report("4 cold TTFB (first request after >=15min idle)", err == nil && ttfb < 500*time.Millisecond,
			fmt.Sprintf("ttfb(first event)=%dms spaced=%d/%d err=%v target<500ms", ttfb.Milliseconds(), sp, tot, err)) {
			os.Exit(1)
		}
		return
	}

	ok := true
	sp, tot, ttfb, err := incremental("GET", base)
	ok = report("1 incremental GET", err == nil && tot == 50 && sp >= 40,
		fmt.Sprintf("spaced>=50ms: %d/%d events (need >=40) ttfb=%dms err=%v", sp, tot, ttfb.Milliseconds(), err)) && ok
	ok = cancellation(base) && ok
	ok = reuse(base) && ok
	sp, tot, ttfb, err = incremental("POST", base)
	ok = report("5 incremental POST", err == nil && tot == 50 && sp >= 40,
		fmt.Sprintf("spaced>=50ms: %d/%d events (need >=40) ttfb=%dms err=%v", sp, tot, ttfb.Milliseconds(), err)) && ok
	fmt.Println("(check 4 cold TTFB: run with `-only cold` after >=15 min idle)")
	if !ok {
		os.Exit(1)
	}
}
