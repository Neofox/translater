// Command assetsize prints the gzip size of every script GET / loads (htmx,
// hx-sse and the application modules, exactly as /static/ serves them) and
// exits non-zero above -max bytes. `make size` runs it.
package main

import (
	"bytes"
	"compress/gzip"
	"flag"
	"fmt"
	"os"

	"neotranslate/internal/web"
	assets "neotranslate/web"
)

func main() {
	max := flag.Int("max", 40960, "gzip byte budget for all page scripts")
	flag.Parse()
	static, err := web.NewStatic(assets.FS)
	if err != nil {
		fmt.Fprintln(os.Stderr, "assetsize:", err)
		os.Exit(1)
	}
	total := 0
	for _, f := range static.Scripts() {
		n := gzipSize(f.Body)
		total += n
		fmt.Printf("%7d raw %6d gzip  %s\n", len(f.Body), n, f.Name)
	}
	fmt.Printf("%21d gzip  total (budget %d)\n", total, *max)
	if total > *max {
		fmt.Fprintf(os.Stderr, "assetsize: %d bytes over budget\n", total-*max)
		os.Exit(1)
	}
}

func gzipSize(b []byte) int {
	var buf bytes.Buffer
	w, _ := gzip.NewWriterLevel(&buf, gzip.BestCompression)
	_, _ = w.Write(b)
	_ = w.Close()
	return buf.Len()
}
