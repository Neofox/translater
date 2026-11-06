// Command neotranslate serves the translator: GET / (page), POST /translate
// (one streaming run), POST /speech (pronunciation PCM), POST /warm,
// POST /prefs and the hashed /static/ assets. It listens on $PORT (default
// 3000).
package main

import (
	"log"
	"net/http"
	"os"

	"neotranslate/internal/config"
	"neotranslate/internal/contract"
	"neotranslate/internal/llm"
	"neotranslate/internal/speech"
	"neotranslate/internal/telemetry"
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
	static, err := web.NewStatic(assets.FS)
	if err != nil {
		return nil, err
	}
	// An invalid TRANSLATE_* setting must not take the page down: runs end
	// with the localized configuration error instead (as for a missing
	// OPENAI_API_KEY). The message names the variable only.
	// Langfuse traces are on only when both keys are set; never fatal.
	opts := []translate.Option{translate.WithTracer(telemetry.Setup(getenv))}
	cfg, err := config.LoadTranslate(getenv)
	if err != nil {
		log.Printf("translation disabled: %v", err)
		opts = append(opts, translate.WithConfigError(err))
	}
	client := llm.New(getenv)
	tr := translate.NewServer(c, cfg, client, opts...)
	// Vercel sets VERCEL/VERCEL_ENV in its runtime; only there does
	// /_vercel/insights/script.js exist.
	onVercel := getenv("VERCEL") != "" || getenv("VERCEL_ENV") != ""
	pages := web.NewPages(c, static, web.WithVercelAnalytics(onVercel))

	mux := http.NewServeMux()
	mux.HandleFunc("GET /{$}", pages.HandlePage)
	mux.HandleFunc("POST /prefs", pages.HandlePrefs)
	mux.HandleFunc("POST /translate", tr.HandleTranslate)
	mux.HandleFunc("POST /warm", tr.HandleWarm)
	// An invalid SPEECH_* setting answers each request with the localized
	// configuration error; it never takes the page down.
	mux.Handle("POST /speech", speech.NewHandler(client, getenv, speech.Timeout))
	mux.Handle("GET /static/", static)
	return mux, nil
}
