// Package jsonstream is an incremental JSON scanner for the OpenAI
// structured-output stream: JSON text arriving in arbitrary deltas.
//
// Why custom (the project prefers maintained libraries): the server must emit
// each string value's decoded text as it arrives, tagged with its JSON path,
// and know the exact moment a string closes, so the main translation streams
// and main-ready never fires on a partial string. No maintained Go library
// does this. encoding/json/jsontext.Decoder yields a string token only once
// it closes; bcicen/jstream emits only completed values; jpoz/flexjson
// re-materialises a map per character without deltas or close events;
// karminski/streaming-json-go, blaze2305/partial-json-parser,
// shado1111w/partialjson and kfet/ai/jsonparse repair and re-parse the whole
// buffer; diillson/chatcli's reader handles completed top-level fields only.
// This scanner does only the streaming part; number grammar is checked with
// jsontext, and full-document validation stays with libraries (Task 10).
//
// Validity matches jsontext's defaults (RFC 7493) except that duplicate object
// names are not detected: invalid UTF-8, unpaired surrogate escapes, raw
// control characters, malformed numbers/literals and trailing data are errors.
//
// Event order: a string value yields zero or more StringChunk events (at most
// one per Feed call, never empty), then StringEnd and ValueEnd on its closing
// quote. Containers yield ValueEnd after all their children. Object keys
// produce no events. A number completes on the byte after it, so a bare
// number at the document root completes in Close and yields no ValueEnd.
package jsonstream

import (
	"bytes"
	"encoding/json/jsontext"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"unicode/utf16"
	"unicode/utf8"
)

// Seg is one step of a Path: an object key or an array index.
type Seg struct {
	Key     string
	Index   int
	IsIndex bool
}

// Path locates a value from the document root; the root itself is empty.
type Path []Seg

// String renders the path as in `alternatives[0].note`.
func (p Path) String() string {
	var b strings.Builder
	for i, s := range p {
		switch {
		case s.IsIndex:
			b.WriteString("[" + strconv.Itoa(s.Index) + "]")
		case i > 0:
			b.WriteString("." + s.Key)
		default:
			b.WriteString(s.Key)
		}
	}
	return b.String()
}

// Kind is the type of an Event.
type Kind int

const (
	// StringChunk carries decoded text appended to a string value since its
	// previous chunk. It never splits a rune, surrogate pair or escape.
	StringChunk Kind = iota
	// StringEnd fires on a string value's closing quote; Text is the whole
	// decoded value.
	StringEnd
	// ValueEnd fires for every completed value; Raw is its exact JSON text
	// (and Text the decoded value for strings).
	ValueEnd
)

func (k Kind) String() string {
	switch k {
	case StringChunk:
		return "StringChunk"
	case StringEnd:
		return "StringEnd"
	case ValueEnd:
		return "ValueEnd"
	}
	return "Kind(" + strconv.Itoa(int(k)) + ")"
}

// Event is one scanner observation.
type Event struct {
	Path Path
	Kind Kind
	Text string
	Raw  []byte
}

// Container frame states.
const (
	objFirst  = iota // after '{': key or '}'
	objKey           // after ',': key
	objColon         // after key: ':'
	objValue         // after ':': value
	objNext          // after value: ',' or '}'
	arrFirst         // after '[': value or ']'
	arrValue         // after ',': value
	arrNext          // after value: ',' or ']'
	rootValue        // document start
	rootDone         // after the root value: whitespace only
)

// Token modes.
const (
	modeNone = iota
	modeString
	modeNumber
	modeLiteral
)

type frame struct {
	state int
	start int // offset of '{' or '['
	key   string
	index int
}

// Scanner consumes JSON text incrementally. The zero value is not usable;
// call New.
type Scanner struct {
	buf    []byte  // everything fed so far, for Raw
	frames []frame // frames[0] is the root pseudo-frame
	err    error

	mode    int
	start   int    // offset of the current scalar
	literal string // modeLiteral: the expected literal

	// modeString
	isKey   bool
	text    []byte // decoded so far
	emitted int    // len(text) already sent as chunks
	esc     int    // 0 none, 1 after '\', 2..5 reading hex digit esc-2
	hex     rune
	high    rune   // pending high surrogate, or 0
	tail    []byte // incomplete UTF-8 sequence
}

// New returns a Scanner positioned before the document's root value.
func New() *Scanner {
	return &Scanner{frames: []frame{{state: rootValue}}}
}

// Feed scans the next piece of the document and returns the events it
// completes. After an error every call returns that error.
func (s *Scanner) Feed(chunk string) ([]Event, error) {
	if s.err != nil {
		return nil, s.err
	}
	var evs []Event
	base := len(s.buf)
	s.buf = append(s.buf, chunk...)
	for i := 0; i < len(chunk); i++ {
		if err := s.step(chunk[i], base+i, &evs); err != nil {
			s.err = fmt.Errorf("jsonstream: offset %d: %w", base+i, err)
			return evs, s.err
		}
	}
	if s.mode == modeString && !s.isKey && len(s.text) > s.emitted {
		evs = append(evs, Event{Path: s.path(), Kind: StringChunk, Text: string(s.text[s.emitted:])})
		s.emitted = len(s.text)
	}
	return evs, nil
}

// Close reports an error if the document is invalid or incomplete.
func (s *Scanner) Close() error {
	if s.err != nil {
		return s.err
	}
	if s.mode == modeNumber && len(s.frames) == 1 {
		if !jsontext.Value(s.buf[s.start:]).IsValid() {
			s.err = errors.New("jsonstream: invalid number")
			return s.err
		}
		s.mode = modeNone
		s.frames[0].state = rootDone
	}
	if s.mode != modeNone || len(s.frames) != 1 || s.frames[0].state != rootDone {
		s.err = errors.New("jsonstream: incomplete document")
	}
	return s.err
}

func (s *Scanner) step(c byte, off int, evs *[]Event) error {
	switch s.mode {
	case modeString:
		return s.stringByte(c, off, evs)
	case modeLiteral:
		if c != s.literal[off-s.start] {
			return errors.New("invalid literal")
		}
		if off-s.start == len(s.literal)-1 {
			s.mode = modeNone
			s.valueEnd(off+1, "", evs)
		}
		return nil
	case modeNumber:
		if strings.IndexByte("0123456789+-.eE", c) >= 0 {
			return nil
		}
		if !jsontext.Value(s.buf[s.start:off]).IsValid() {
			return errors.New("invalid number")
		}
		s.mode = modeNone
		s.valueEnd(off, "", evs)
	}

	if c == ' ' || c == '\t' || c == '\n' || c == '\r' {
		return nil
	}
	f := &s.frames[len(s.frames)-1]
	switch f.state {
	case objFirst, objKey:
		if c == '}' && f.state == objFirst {
			return s.closeContainer(off, evs)
		}
		if c != '"' {
			return errors.New("expected object key")
		}
		s.beginString(true, off)
	case objColon:
		if c != ':' {
			return errors.New("expected ':'")
		}
		f.state = objValue
	case objNext, arrNext:
		switch {
		case c == ',' && f.state == objNext:
			f.state = objKey
		case c == ',':
			f.state = arrValue
			f.index++
		case c == '}' && f.state == objNext, c == ']' && f.state == arrNext:
			return s.closeContainer(off, evs)
		default:
			return errors.New("expected ',' or end of container")
		}
	case arrFirst, arrValue, objValue, rootValue:
		if c == ']' && f.state == arrFirst {
			return s.closeContainer(off, evs)
		}
		return s.beginValue(c, off)
	default: // rootDone
		return errors.New("data after the root value")
	}
	return nil
}

func (s *Scanner) beginValue(c byte, off int) error {
	s.start = off
	switch {
	case c == '{':
		s.frames = append(s.frames, frame{state: objFirst, start: off})
	case c == '[':
		s.frames = append(s.frames, frame{state: arrFirst, start: off})
	case c == '"':
		s.beginString(false, off)
	case c == '-' || c >= '0' && c <= '9':
		s.mode = modeNumber
	case c == 't':
		s.mode, s.literal = modeLiteral, "true"
	case c == 'f':
		s.mode, s.literal = modeLiteral, "false"
	case c == 'n':
		s.mode, s.literal = modeLiteral, "null"
	default:
		return errors.New("expected value")
	}
	return nil
}

func (s *Scanner) beginString(isKey bool, off int) {
	s.mode, s.isKey, s.start = modeString, isKey, off
	s.text, s.emitted, s.esc, s.high, s.tail = s.text[:0], 0, 0, 0, s.tail[:0]
}

func (s *Scanner) stringByte(c byte, off int, evs *[]Event) error {
	if s.high != 0 && s.esc == 0 && c != '\\' {
		return errors.New("unpaired surrogate escape")
	}
	switch {
	case s.esc == 1:
		if c == 'u' {
			s.esc, s.hex = 2, 0
			return nil
		}
		if s.high != 0 {
			return errors.New("unpaired surrogate escape")
		}
		i := strings.IndexByte(`"\/bfnrt`, c)
		if i < 0 {
			return errors.New("invalid escape")
		}
		s.text = append(s.text, "\"\\/\b\f\n\r\t"[i])
		s.esc = 0
	case s.esc >= 2:
		d, ok := hexDigit(c)
		if !ok {
			return errors.New("invalid \\u escape")
		}
		s.hex = s.hex<<4 | d
		if s.esc++; s.esc < 6 {
			return nil
		}
		s.esc = 0
		return s.escapedRune(s.hex)
	case len(s.tail) > 0 || c >= utf8.RuneSelf:
		s.tail = append(s.tail, c)
		if !utf8.FullRune(s.tail) {
			return nil
		}
		r, n := utf8.DecodeRune(s.tail)
		if r == utf8.RuneError || n != len(s.tail) {
			return errors.New("invalid UTF-8")
		}
		s.text = append(s.text, s.tail...)
		s.tail = s.tail[:0]
	case c == '\\':
		s.esc = 1
	case c == '"':
		return s.endString(off, evs)
	case c < 0x20:
		return errors.New("control character in string")
	default:
		s.text = append(s.text, c)
	}
	return nil
}

func (s *Scanner) escapedRune(r rune) error {
	switch {
	case s.high != 0:
		if !utf16.IsSurrogate(r) || r < 0xDC00 {
			return errors.New("unpaired surrogate escape")
		}
		s.text = utf8.AppendRune(s.text, utf16.DecodeRune(s.high, r))
		s.high = 0
	case r >= 0xD800 && r < 0xDC00:
		s.high = r
	case r >= 0xDC00 && r < 0xE000:
		return errors.New("unpaired surrogate escape")
	default:
		s.text = utf8.AppendRune(s.text, r)
	}
	return nil
}

func (s *Scanner) endString(off int, evs *[]Event) error {
	s.mode = modeNone
	if s.isKey {
		f := &s.frames[len(s.frames)-1]
		f.key, f.state = string(s.text), objColon
		return nil
	}
	p := s.path()
	if len(s.text) > s.emitted {
		*evs = append(*evs, Event{Path: p, Kind: StringChunk, Text: string(s.text[s.emitted:])})
	}
	text := string(s.text)
	*evs = append(*evs, Event{Path: p, Kind: StringEnd, Text: text})
	s.valueEnd(off+1, text, evs)
	return nil
}

// valueEnd records a completed scalar spanning buf[s.start:end].
func (s *Scanner) valueEnd(end int, text string, evs *[]Event) {
	*evs = append(*evs, Event{Path: s.path(), Kind: ValueEnd, Text: text, Raw: bytes.Clone(s.buf[s.start:end])})
	s.advance()
}

func (s *Scanner) closeContainer(off int, evs *[]Event) error {
	f := s.frames[len(s.frames)-1]
	s.frames = s.frames[:len(s.frames)-1]
	*evs = append(*evs, Event{Path: s.path(), Kind: ValueEnd, Raw: bytes.Clone(s.buf[f.start : off+1])})
	s.advance()
	return nil
}

// advance moves the innermost frame past a completed child value.
func (s *Scanner) advance() {
	f := &s.frames[len(s.frames)-1]
	switch f.state {
	case objValue:
		f.state = objNext
	case arrFirst, arrValue:
		f.state = arrNext
	case rootValue:
		f.state = rootDone
	}
}

// path returns a fresh copy of the current value's path.
func (s *Scanner) path() Path {
	if len(s.frames) == 1 {
		return nil
	}
	p := make(Path, 0, len(s.frames)-1)
	for _, f := range s.frames[1:] {
		if f.state >= arrFirst {
			p = append(p, Seg{Index: f.index, IsIndex: true})
		} else {
			p = append(p, Seg{Key: f.key})
		}
	}
	return p
}

func hexDigit(c byte) (rune, bool) {
	switch {
	case c >= '0' && c <= '9':
		return rune(c - '0'), true
	case c >= 'a' && c <= 'f':
		return rune(c-'a') + 10, true
	case c >= 'A' && c <= 'F':
		return rune(c-'A') + 10, true
	}
	return 0, false
}
