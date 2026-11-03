package fakeopenai_test

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json/v2"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"neotranslate/internal/fakeopenai"
	"neotranslate/internal/speech"
)

func postSpeech(t *testing.T, ctx context.Context, url, input string) (*http.Response, string) {
	t.Helper()
	body, _ := json.Marshal(map[string]any{
		"model": "gpt-4o-mini-tts", "input": input, "voice": "marin",
		"instructions": "Read the text aloud in Korean.", "response_format": "wav",
	})
	req, _ := http.NewRequestWithContext(ctx, "POST", url+"/v1/audio/speech", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		if errors.Is(err, context.Canceled) {
			return nil, string(body)
		}
		t.Fatal(err)
	}
	return res, string(body)
}

func readAll(t *testing.T, res *http.Response) []byte {
	t.Helper()
	defer res.Body.Close()
	b, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func TestFakeSpeechWAV(t *testing.T) {
	srv := httptest.NewServer(fakeopenai.Handler(fixturesDir))
	defer srv.Close()
	res, sent := postSpeech(t, context.Background(), srv.URL, "안녕하세요")
	wav := readAll(t, res)
	if res.StatusCode != 200 || res.Header.Get("Content-Type") != "audio/wav" {
		t.Fatalf("status %d, content type %q", res.StatusCode, res.Header.Get("Content-Type"))
	}
	le := binary.LittleEndian
	if string(wav[0:4]) != "RIFF" || le.Uint32(wav[4:]) != 0xFFFFFFFF || string(wav[8:12]) != "WAVE" {
		t.Fatalf("RIFF header % x", wav[:12])
	}
	// fmt: PCM 1, mono, 24,000 Hz, byteRate 48,000, blockAlign 2, 16 bit.
	if string(wav[12:16]) != "fmt " || le.Uint32(wav[16:]) != 16 || le.Uint16(wav[20:]) != 1 ||
		le.Uint16(wav[22:]) != 1 || le.Uint32(wav[24:]) != 24000 || le.Uint32(wav[28:]) != 48000 ||
		le.Uint16(wav[32:]) != 2 || le.Uint16(wav[34:]) != 16 {
		t.Fatalf("fmt chunk % x", wav[12:36])
	}
	// LIST metadata precedes the open-ended data chunk.
	if string(wav[36:40]) != "LIST" {
		t.Fatalf("chunk after fmt = %q", wav[36:40])
	}
	listSize := int(le.Uint32(wav[40:]))
	data := 44 + listSize + listSize%2
	if string(wav[data:data+4]) != "data" || le.Uint32(wav[data+4:]) != 0xFFFFFFFF {
		t.Fatalf("data header % x", wav[data:data+8])
	}
	pcm := wav[data+8:]
	if len(pcm) != 12000 || !bytes.Equal(pcm, fakeopenai.SpeechTone()) {
		t.Fatalf("pcm = %d B", len(pcm))
	}
	// A 440 Hz tone: nonzero samples, signed little-endian.
	if int16(le.Uint16(pcm[0:])) != 0 || int16(le.Uint16(pcm[2:])) <= 0 {
		t.Errorf("tone starts % x", pcm[:4])
	}
	// The Go app's validator accepts it as-is.
	if got, rate, err := speech.PCMFromWAV(wav); err != nil || rate != 24000 || !bytes.Equal(got, pcm) {
		t.Errorf("PCMFromWAV: %d B at %d Hz, %v", len(got), rate, err)
	}
	st := stats(t, srv.URL)
	if st.SpeechRequests != 1 || st.SpeechAborted != 0 || st.Requests != 0 || st.Active != 0 ||
		len(st.LastSpeechBodies) != 1 || st.LastSpeechBodies[0] != sent || len(st.LastBodies) != 0 {
		t.Fatalf("stats %+v", st)
	}
}

func TestFakeSpeechVariants(t *testing.T) {
	srv := httptest.NewServer(fakeopenai.Handler(fixturesDir))
	defer srv.Close()

	res, _ := postSpeech(t, context.Background(), srv.URL, "x [fx:speech-error] y")
	body := readAll(t, res)
	if res.StatusCode != 500 || !strings.Contains(string(body), fakeopenai.FaultMessage) {
		t.Errorf("error: %d %s", res.StatusCode, body)
	}

	res, _ = postSpeech(t, context.Background(), srv.URL, "[fx:speech-bad]")
	wav := readAll(t, res)
	if res.StatusCode != 200 || binary.LittleEndian.Uint16(wav[34:]) != 8 {
		t.Errorf("bad: %d, bits % x", res.StatusCode, wav[34:36])
	}
	if _, _, err := speech.PCMFromWAV(wav); err == nil {
		t.Error("bad: the 8-bit WAV validated")
	}

	res, _ = postSpeech(t, context.Background(), srv.URL, "[fx:speech-big]")
	wav = readAll(t, res)
	pcm, rate, err := speech.PCMFromWAV(wav)
	if err != nil || rate != 24000 || len(pcm) != 2621440 {
		t.Errorf("big: %d B at %d Hz, %v", len(pcm), rate, err)
	}

	start := time.Now()
	res, _ = postSpeech(t, context.Background(), srv.URL, "[fx:speech-slow]")
	if elapsed := time.Since(start); elapsed < 3*time.Second {
		t.Errorf("slow headers after %v", elapsed)
	}
	if pcm, _, err := speech.PCMFromWAV(readAll(t, res)); err != nil || len(pcm) != 12000 {
		t.Errorf("slow: %d B, %v", len(pcm), err)
	}

	for i := range 3 {
		res, _ := postSpeech(t, context.Background(), srv.URL, "body "+string(rune('a'+i)))
		readAll(t, res)
	}
	st := stats(t, srv.URL)
	if st.SpeechRequests != 7 || len(st.LastSpeechBodies) != 5 || !strings.Contains(st.LastSpeechBodies[4], "body c") ||
		!strings.Contains(st.LastSpeechBodies[0], "[fx:speech-big]") {
		t.Errorf("stats %d requests, bodies %d", st.SpeechRequests, len(st.LastSpeechBodies))
	}
	r, _ := http.Post(srv.URL+"/_reset", "", nil)
	r.Body.Close()
	if st := stats(t, srv.URL); st.SpeechRequests != 0 || st.SpeechAborted != 0 || st.LastSpeechBodies == nil || len(st.LastSpeechBodies) != 0 {
		t.Errorf("after reset %+v", st)
	}
}

// Leaving during the slow wait counts as a speech abort (not a translation
// abort), and Active drops only after it was counted.
func TestFakeSpeechAbortCounted(t *testing.T) {
	srv := httptest.NewServer(fakeopenai.Handler(fixturesDir))
	defer srv.Close()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		if res, _ := postSpeech(t, ctx, srv.URL, "[fx:speech-slow]"); res != nil {
			res.Body.Close()
		}
	}()
	deadline := time.Now().Add(2 * time.Second)
	for st := stats(t, srv.URL); st.Active != 1; st = stats(t, srv.URL) {
		if time.Now().After(deadline) {
			t.Fatalf("never active: %+v", st)
		}
		time.Sleep(10 * time.Millisecond)
	}
	cancel()
	<-done
	for st := stats(t, srv.URL); st.SpeechAborted != 1 || st.Active != 0; st = stats(t, srv.URL) {
		if time.Now().After(deadline) {
			t.Fatalf("after abort: %+v", st)
		}
		time.Sleep(10 * time.Millisecond)
	}
	if st := stats(t, srv.URL); st.Aborted != 0 || st.SpeechRequests != 1 {
		t.Errorf("stats %+v", st)
	}
}
