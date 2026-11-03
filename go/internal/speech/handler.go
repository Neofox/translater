package speech

import (
	"context"
	"encoding/json/v2"
	"errors"
	"io"
	"mime"
	"net/http"
	"strconv"
	"time"
	"unicode/utf8"

	"github.com/openai/openai-go/v3"

	"neotranslate/internal/llm"
)

const (
	// Timeout is the production limit for generating and downloading one
	// speech response.
	Timeout = 90 * time.Second
	// writeSize is the PCM written (and flushed) per Write.
	writeSize    = 32768
	maxFormBytes = 64 << 10
)

var messages = map[string][2]string{ // uiLang → {failed, configuration}
	"en": {"Pronunciation failed. Please try again.", "Pronunciation is not configured correctly."},
	"ko": {"발음을 재생하지 못했어요. 다시 시도해 주세요.", "발음 재생 설정이 올바르지 않아요."},
}

type handler struct {
	client  *llm.Client
	cfg     Config
	cfgErr  error
	timeout time.Duration
}

// NewHandler serves POST /speech with form fields text, language and uiLang
// (urlencoded or multipart). It sends one speech request (no retry) and
// answers 200 with the validated PCM as audio/L16 (little-endian samples;
// the rate parameter carries the WAV's rate). Only after the whole WAV
// validates is anything written. Errors are JSON {"error": message} in the
// request's uiLang: 400 invalid input, 500 configuration (SPEECH_* or a
// missing OPENAI_API_KEY), 502 provider failure or invalid audio, 504 when
// timeout elapses. The upstream request runs under r.Context(), so a client
// that leaves cancels it only where the host cancels r.Context() on
// disconnect (net/http does); on Vercel the request is not cancelled and the
// upstream call runs until it completes or the timeout elapses.
func NewHandler(c *llm.Client, getenv func(string) string, timeout time.Duration) http.Handler {
	cfg, err := LoadConfig(getenv)
	return &handler{client: c, cfg: cfg, cfgErr: err, timeout: timeout}
}

func (h *handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	in, ui, err := parse(w, r)
	if err != nil {
		writeError(w, http.StatusBadRequest, messages[ui][0])
		return
	}
	failed, configuration := messages[ui][0], messages[ui][1]
	if h.cfgErr != nil {
		writeError(w, http.StatusInternalServerError, configuration)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), h.timeout)
	defer cancel()

	pcm, rate, err := h.synthesize(ctx, in)
	switch {
	case err == nil:
	case r.Context().Err() != nil: // the client left: nobody to answer
		return
	case errors.Is(ctx.Err(), context.DeadlineExceeded):
		writeError(w, http.StatusGatewayTimeout, failed)
		return
	case errors.Is(err, llm.ErrMissingAPIKey):
		writeError(w, http.StatusInternalServerError, configuration)
		return
	default:
		writeError(w, http.StatusBadGateway, failed)
		return
	}

	rc := http.NewResponseController(w)
	hdr := w.Header()
	hdr.Set("Content-Type", "audio/L16;rate="+strconv.Itoa(rate)+";channels=1")
	hdr.Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	for len(pcm) > 0 {
		n := min(writeSize, len(pcm))
		if _, err := w.Write(pcm[:n]); err != nil {
			return
		}
		if err := rc.Flush(); err != nil {
			return
		}
		pcm = pcm[n:]
	}
}

// synthesize requests WAV audio and returns its validated PCM. Its errors
// may carry provider text: they are classified, never logged or shown.
func (h *handler) synthesize(ctx context.Context, in Input) ([]byte, int, error) {
	res, err := h.client.Speech(ctx, openai.AudioSpeechNewParams{
		Model:          h.cfg.Model,
		Voice:          openai.AudioSpeechNewParamsVoiceUnion{OfString: openai.String(h.cfg.Voice)},
		Input:          in.Text,
		Instructions:   openai.String(Instructions(in.Language)),
		ResponseFormat: openai.AudioSpeechNewParamsResponseFormatWAV,
	})
	if err != nil {
		return nil, 0, err
	}
	defer res.Body.Close()
	// One byte over the container limit is enough to reject an oversized body.
	wav, err := io.ReadAll(io.LimitReader(res.Body, maxWAVBytes+1))
	if err != nil {
		return nil, 0, err
	}
	return PCMFromWAV(wav)
}

// parse reads the form and returns the input and the uiLang for messages
// ("en" unless the request asked for "ko").
func parse(w http.ResponseWriter, r *http.Request) (Input, string, error) {
	r.Body = http.MaxBytesReader(w, r.Body, maxFormBytes)
	var err error
	if mt, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type")); mt == "multipart/form-data" {
		err = r.ParseMultipartForm(maxFormBytes)
	} else {
		err = r.ParseForm()
	}
	ui := "en"
	if r.PostForm.Get("uiLang") == "ko" {
		ui = "ko"
	}
	if err != nil {
		return Input{}, ui, errInput
	}
	text, language, uiLang := r.PostForm.Get("text"), r.PostForm.Get("language"), r.PostForm.Get("uiLang")
	if !utf8.ValidString(text) || !utf8.ValidString(language) || !utf8.ValidString(uiLang) {
		return Input{}, ui, errInput
	}
	in, err := ParseInput(text, language, uiLang)
	return in, ui, err
}

func writeError(w http.ResponseWriter, status int, message string) {
	body, _ := json.Marshal(map[string]string{"error": message})
	hdr := w.Header()
	hdr.Set("Content-Type", "application/json")
	hdr.Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	w.Write(body)
}
