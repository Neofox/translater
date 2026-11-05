package fakeopenai

import (
	"bytes"
	"encoding/binary"
	"encoding/json/v2"
	"io"
	"math"
	"net/http"
	"slices"
	"strings"
	"time"
)

// Speech variants, chosen by a marker anywhere in the request's `input`
// (the translated text the browser asks to pronounce).
const (
	speechSlow  = "[fx:speech-slow]"  // wait 3 s before headers
	speechError = "[fx:speech-error]" // HTTP 500 carrying FaultMessage
	speechBig   = "[fx:speech-big]"   // 2.5 MiB of PCM
	speechBad   = "[fx:speech-bad]"   // an 8-bit WAV the apps must reject

	speechRate      = 24000
	speechSlowDelay = 3 * time.Second
	toneBytes       = speechRate / 4 * 2 // 0.25 s of mono PCM16
	bigBytes        = 5 << 19            // 2.5 MiB
)

// SpeechTone is the PCM of the default fake speech: 0.25 s of a 440 Hz sine
// at 24,000 Hz, signed 16-bit little-endian (12,000 B).
func SpeechTone() []byte { return tone(toneBytes / 2) }

// tone returns n samples of the 440 Hz sine at a quarter of full scale.
func tone(n int) []byte {
	out := make([]byte, 0, 2*n)
	for i := range n {
		v := int16(math.Round(8192 * math.Sin(2*math.Pi*440*float64(i)/speechRate)))
		out = binary.LittleEndian.AppendUint16(out, uint16(v))
	}
	return out
}

// speechWAV frames pcm the way OpenAI streams a WAV: placeholder RIFF and
// data sizes (0xFFFFFFFF), and a LIST metadata chunk before the data, which
// runs to the end of the body.
func speechWAV(pcm []byte, bits uint16) []byte {
	le := binary.LittleEndian
	blockAlign := bits / 8
	var b bytes.Buffer
	b.WriteString("RIFF")
	b.Write(le.AppendUint32(nil, 0xFFFFFFFF))
	b.WriteString("WAVEfmt ")
	b.Write(le.AppendUint32(nil, 16))
	b.Write(le.AppendUint16(nil, 1)) // PCM
	b.Write(le.AppendUint16(nil, 1)) // mono
	b.Write(le.AppendUint32(nil, speechRate))
	b.Write(le.AppendUint32(nil, speechRate*uint32(blockAlign)))
	b.Write(le.AppendUint16(nil, blockAlign))
	b.Write(le.AppendUint16(nil, bits))
	info := []byte("INFOISFT\x0e\x00\x00\x00fakeopenai tts")
	b.WriteString("LIST")
	b.Write(le.AppendUint32(nil, uint32(len(info))))
	b.Write(info)
	b.WriteString("data")
	b.Write(le.AppendUint32(nil, 0xFFFFFFFF))
	b.Write(pcm)
	return b.Bytes()
}

func (s *server) countSpeechAbort() {
	s.mu.Lock()
	s.st.SpeechAborted++
	s.mu.Unlock()
}

// speech serves POST /v1/audio/speech with a deterministic WAV, recording
// the JSON body. A client that leaves while the fake waits or writes counts
// as a speech abort.
func (s *server) speech(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	s.st.Active++
	s.mu.Unlock()
	// Deferred first, so it runs last: after any abort was counted.
	defer func() {
		s.mu.Lock()
		s.st.Active--
		s.mu.Unlock()
	}()
	raw, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "read body", http.StatusBadRequest)
		return
	}
	s.mu.Lock()
	s.st.SpeechRequests++
	s.st.LastSpeechBodies = append(s.st.LastSpeechBodies, string(raw))
	if n := len(s.st.LastSpeechBodies); n > maxBodies {
		s.st.LastSpeechBodies = slices.Clone(s.st.LastSpeechBodies[n-maxBodies:])
	}
	s.mu.Unlock()

	var body struct {
		Input string `json:"input"`
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		writeError(w, http.StatusBadRequest, nil)
		return
	}
	pcm, bits := SpeechTone(), uint16(16)
	switch {
	case strings.Contains(body.Input, speechSlow):
		select {
		case <-r.Context().Done():
			s.countSpeechAbort()
			return
		case <-time.After(speechSlowDelay):
		}
	case strings.Contains(body.Input, speechError):
		writeError(w, http.StatusInternalServerError, []byte(
			`{"error":{"message":"`+FaultMessage+`","type":"server_error","param":null,"code":null}}`))
		return
	case strings.Contains(body.Input, speechBig):
		pcm = tone(bigBytes / 2)
	case strings.Contains(body.Input, speechBad):
		bits = 8 // the same bytes declared as 8-bit samples
	}
	w.Header().Set("Content-Type", "audio/wav")
	if _, err := w.Write(speechWAV(pcm, bits)); err != nil {
		s.countSpeechAbort()
	}
}
