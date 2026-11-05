package speech

import (
	"encoding/binary"
	"errors"
)

// Hand-written because the check is a few lines and must match the TS
// validator (pcmFromWav in src/server/speech.server.ts) exactly; WAV libraries
// decode to samples and reject OpenAI's streaming placeholder sizes.

const (
	// MaxAudioBytes bounds the PCM payload (8 MiB).
	MaxAudioBytes = 8 << 20
	// maxWAVBytes allows the container and metadata around the PCM.
	maxWAVBytes   = MaxAudioBytes + 65536
	streamingSize = 0xFFFFFFFF
)

var (
	errAudioSize   = errors.New("speech: unsupported audio size")
	errContainer   = errors.New("speech: incomplete WAV container")
	errChunk       = errors.New("speech: incomplete WAV chunk")
	errChunkData   = errors.New("speech: incomplete WAV data")
	errFormat      = errors.New("speech: invalid WAV format")
	errUnsupported = errors.New("speech: unsupported WAV format")
	errPCM         = errors.New("speech: invalid PCM data")
	errMissingPCM  = errors.New("speech: missing PCM data")
)

// PCMFromWAV accepts a complete mono PCM16 WAV at 8,000–48,000 Hz and
// returns its samples (a subslice of wav) and rate, discarding every other
// chunk (LIST, C2PA and other metadata). OpenAI writes its header before the
// audio exists, so the RIFF and data sizes may be the streaming placeholder
// 0xFFFFFFFF; such a data chunk runs to the end of the input.
func PCMFromWAV(wav []byte) (pcm []byte, sampleRate int, err error) {
	if len(wav) < 44 || len(wav) > maxWAVBytes {
		return nil, 0, errAudioSize
	}
	le := binary.LittleEndian
	tag := func(offset int) string { return string(wav[offset : offset+4]) }
	riffSize := le.Uint32(wav[4:])
	if tag(0) != "RIFF" || tag(8) != "WAVE" || (riffSize != streamingSize && int(riffSize)+8 != len(wav)) {
		return nil, 0, errContainer
	}
	haveFmt, haveData := false, false
	offset := 12
	for offset < len(wav) {
		if offset+8 > len(wav) {
			return nil, 0, errChunk
		}
		kind := tag(offset)
		declared := le.Uint32(wav[offset+4:])
		length := int(declared)
		if kind == "data" && declared == streamingSize {
			length = len(wav) - offset - 8
		}
		start := offset + 8
		end := start + length
		next := end + length%2
		if next > len(wav) {
			return nil, 0, errChunkData
		}
		switch kind {
		case "fmt ":
			if haveFmt || length < 16 {
				return nil, 0, errFormat
			}
			rate := le.Uint32(wav[start+4:])
			if le.Uint16(wav[start:]) != 1 ||
				le.Uint16(wav[start+2:]) != 1 ||
				le.Uint16(wav[start+14:]) != 16 ||
				le.Uint16(wav[start+12:]) != 2 ||
				uint64(le.Uint32(wav[start+8:])) != uint64(rate)*2 ||
				rate < 8000 ||
				rate > 48000 {
				return nil, 0, errUnsupported
			}
			haveFmt, sampleRate = true, int(rate)
		case "data":
			if haveData || length == 0 || length%2 != 0 || length > MaxAudioBytes {
				return nil, 0, errPCM
			}
			haveData, pcm = true, wav[start:end]
		}
		offset = next
	}
	if !haveData || !haveFmt {
		return nil, 0, errMissingPCM
	}
	return pcm, sampleRate, nil
}
