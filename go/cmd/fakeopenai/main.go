// Command fakeopenai serves the fake OpenAI Responses API for browser tests.
package main

import (
	"flag"
	"log"
	"net/http"

	"neotranslate/internal/fakeopenai"
)

func main() {
	addr := flag.String("addr", "127.0.0.1:3901", "listen address")
	fixtures := flag.String("fixtures", "../e2e/fixtures/results", "fixtures directory")
	flag.Parse()
	log.Printf("fakeopenai listening on %s (fixtures %s)", *addr, *fixtures)
	log.Fatal(http.ListenAndServe(*addr, fakeopenai.Handler(*fixtures)))
}
