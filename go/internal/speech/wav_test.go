package speech_test

import (
	"bytes"
	"encoding/binary"
	"testing"

	"neotranslate/internal/speech"
)

type format struct {
	tag, channels, bits, blockAlign uint16
	rate, byteRate                  uint32
}

func pcm16(rate uint32) format {
	return format{tag: 1, channels: 1, bits: 16, blockAlign: 2, rate: rate, byteRate: rate * 2}
}

func fmtChunk(f format) []byte {
	b := make([]byte, 16)
	binary.LittleEndian.PutUint16(b[0:], f.tag)
	binary.LittleEndian.PutUint16(b[2:], f.channels)
	binary.LittleEndian.PutUint32(b[4:], f.rate)
	binary.LittleEndian.PutUint32(b[8:], f.byteRate)
	binary.LittleEndian.PutUint16(b[12:], f.blockAlign)
	binary.LittleEndian.PutUint16(b[14:], f.bits)
	return chunk("fmt ", b)
}

// chunk frames body with its id and size, adding the pad byte for odd sizes.
func chunk(id string, body []byte) []byte {
	out := sizedChunk(id, uint32(len(body)), body)
	if len(body)%2 == 1 {
		out = append(out, 0)
	}
	return out
}

// sizedChunk frames body with a declared size and no padding.
func sizedChunk(id string, size uint32, body []byte) []byte {
	return append(append([]byte(id), binary.LittleEndian.AppendUint32(nil, size)...), body...)
}

// riff wraps chunks in an exact-size RIFF/WAVE container.
func riff(chunks ...[]byte) []byte {
	body := append([]byte("WAVE"), bytes.Join(chunks, nil)...)
	return append(append([]byte("RIFF"), binary.LittleEndian.AppendUint32(nil, uint32(len(body)))...), body...)
}

func wav(data []byte, f format) []byte { return riff(fmtChunk(f), chunk("data", data)) }

var samples = []byte{1, 0, 2, 0}

func TestPCMFromWAV(t *testing.T) {
	accept := func(name string, in []byte, want []byte, wantRate int) {
		t.Helper()
		pcm, rate, err := speech.PCMFromWAV(in)
		if err != nil || !bytes.Equal(pcm, want) || rate != wantRate {
			t.Errorf("%s: pcm=%v rate=%d err=%v", name, pcm, rate, err)
		}
	}
	accept("exact RIFF size", wav(samples, pcm16(24000)), samples, 24000)

	streamed := riff(fmtChunk(pcm16(24000)), sizedChunk("data", 0xFFFFFFFF, []byte{1, 0, 2, 0, 3, 0}))
	binary.LittleEndian.PutUint32(streamed[4:], 0xFFFFFFFF)
	accept("streaming sizes", streamed, []byte{1, 0, 2, 0, 3, 0}, 24000)

	accept("LIST discarded", riff(fmtChunk(pcm16(24000)), chunk("LIST", []byte("INFOISFT\x04\x00\x00\x00fake")), chunk("data", samples)), samples, 24000)
	accept("odd-chunk padding", riff(fmtChunk(pcm16(24000)), chunk("C2PA", []byte{80, 82, 73}), chunk("data", samples)), samples, 24000)
	accept("trailing metadata", riff(fmtChunk(pcm16(24000)), chunk("data", samples), chunk("C2PA", []byte{80, 82, 73, 86})), samples, 24000)
	accept("rate 8000", wav(samples, pcm16(8000)), samples, 8000)
	accept("rate 48000", wav(samples, pcm16(48000)), samples, 48000)
	accept("rate 16000", wav(samples, pcm16(16000)), samples, 16000)

	bad := func(mut func(*format)) []byte {
		f := pcm16(24000)
		mut(&f)
		return wav(samples, f)
	}
	badRIFF := wav(samples, pcm16(24000))
	binary.LittleEndian.PutUint32(badRIFF[4:], uint32(len(badRIFF)))
	streamedOdd := riff(fmtChunk(pcm16(24000)), sizedChunk("data", 0xFFFFFFFF, []byte{1, 0, 2}))
	truncatedChunk := append(wav(samples, pcm16(24000)), 'L', 'I', 'S', 'T')
	binary.LittleEndian.PutUint32(truncatedChunk[4:], 0xFFFFFFFF)
	notWAVE := wav(samples, pcm16(24000))
	copy(notWAVE[8:], "AVI ")
	for name, in := range map[string][]byte{
		"rate 7999":        bad(func(f *format) { f.rate, f.byteRate = 7999, 7999*2 }),
		"rate 48001":       bad(func(f *format) { f.rate, f.byteRate = 48001, 48001*2 }),
		"rate 96000":       bad(func(f *format) { f.rate, f.byteRate = 96000, 96000*2 }),
		"rate 0":           bad(func(f *format) { f.rate, f.byteRate = 0, 0 }),
		"compressed":       bad(func(f *format) { f.tag = 3 }),
		"stereo":           bad(func(f *format) { f.channels, f.blockAlign, f.byteRate = 2, 4, 24000*4 }),
		"8-bit":            bad(func(f *format) { f.bits, f.blockAlign, f.byteRate = 8, 1, 24000 }),
		"bad blockAlign":   bad(func(f *format) { f.blockAlign = 4 }),
		"bad byteRate":     bad(func(f *format) { f.byteRate = 1 }),
		"two fmt":          riff(fmtChunk(pcm16(24000)), fmtChunk(pcm16(24000)), chunk("data", samples)),
		"two data":         riff(fmtChunk(pcm16(24000)), chunk("data", samples), chunk("data", samples)),
		"short fmt":        riff(chunk("fmt ", make([]byte, 14)), chunk("data", samples)),
		"no fmt":           riff(chunk("LIST", make([]byte, 40)), chunk("data", samples)),
		"no data":          riff(fmtChunk(pcm16(24000)), chunk("LIST", make([]byte, 40))),
		"empty data":       riff(fmtChunk(pcm16(24000)), chunk("data", nil), chunk("LIST", make([]byte, 8))),
		"odd data":         wav([]byte{1, 0, 2}, pcm16(24000)),
		"odd streamed":     streamedOdd,
		"data > 8 MiB":     wav(make([]byte, 8<<20+2), pcm16(24000)),
		"container > max":  wav(make([]byte, 8<<20+65536), pcm16(24000)),
		"< 44 B":           wav(samples, pcm16(24000))[:43],
		"truncated header": wav(samples, pcm16(24000))[:20],
		"truncated audio":  wav(samples, pcm16(24000))[:46],
		"truncated chunk":  truncatedChunk,
		"wrong RIFF size":  badRIFF,
		"wrong container":  make([]byte, 48),
		"not WAVE":         notWAVE,
		"empty":            nil,
	} {
		if pcm, rate, err := speech.PCMFromWAV(in); err == nil {
			t.Errorf("%s: accepted (%d B at %d Hz)", name, len(pcm), rate)
		}
	}
}

// Exactly 8 MiB of PCM is the largest accepted payload.
func TestPCMFromWAVLimit(t *testing.T) {
	pcm, _, err := speech.PCMFromWAV(wav(make([]byte, 8<<20), pcm16(24000)))
	if err != nil || len(pcm) != 8<<20 {
		t.Fatalf("8 MiB: %d B, %v", len(pcm), err)
	}
}

func FuzzPCMFromWAV(f *testing.F) {
	f.Add(wav(samples, pcm16(24000)))
	f.Add(riff(fmtChunk(pcm16(24000)), chunk("LIST", []byte{1, 2, 3}), sizedChunk("data", 0xFFFFFFFF, samples)))
	f.Fuzz(func(t *testing.T, in []byte) {
		pcm, rate, err := speech.PCMFromWAV(in)
		if err != nil {
			return
		}
		if len(pcm) == 0 || len(pcm)%2 != 0 || rate < 8000 || rate > 48000 {
			t.Fatalf("accepted pcm=%d rate=%d", len(pcm), rate)
		}
	})
}
