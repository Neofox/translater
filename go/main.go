// Command neotranslate serves the translator: GET / (page), POST /translate
// (one streaming run), POST /warm, POST /prefs and the hashed /static/
// assets. It listens on $PORT (default 3000).
package main

import (
	"log"
	"net/http"
	"os"

	"neotranslate/internal/config"
	"neotranslate/internal/contract"
	"neotranslate/internal/llm"
	"neotranslate/internal/translate"
	"neotranslate/internal/web"
	assets "neotranslate/web"
)

func main() {
	mux, err := newMux(os.Getenv)
	if err != nil {
		log.Fatal(err)
	}
	port := os.Getenv("PORT")
	if port == "" {
		port = "3000"
	}
	log.Printf("listening on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, mux))
}

func newMux(getenv func(string) string) (*http.ServeMux, error) {
	c, err := contract.Load()
	if err != nil {
		return nil, err
	}
	cfg, err := config.LoadTranslate(getenv)
	if err != nil {
		return nil, err
	}
	static, err := web.NewStatic(assets.FS)
	if err != nil {
		return nil, err
	}
	tr := translate.NewServer(c, cfg, llm.New(getenv))
	pages := web.NewPages(c, static)

	mux := http.NewServeMux()
	mux.HandleFunc("GET /{$}", pages.HandlePage)
	mux.HandleFunc("POST /prefs", pages.HandlePrefs)
	mux.HandleFunc("POST /translate", tr.HandleTranslate)
	mux.HandleFunc("POST /warm", tr.HandleWarm)
	mux.Handle("GET /static/", static)
	if getenv("NT_SPIKE") == "1" {
		registerSpike(mux, static.URL)
	}
	return mux, nil
}
