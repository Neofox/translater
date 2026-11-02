package jsonstream

import (
	"encoding/json/jsontext"
	"encoding/json/v2"
	"fmt"
	"math/rand/v2"
	"reflect"
	"strings"
	"testing"
	"unicode/utf8"
)

// feedAll feeds the parts in order, then closes. It returns every event and
// the first error (from Feed or Close).
func feedAll(parts ...string) ([]Event, error) {
	s := New()
	var all []Event
	for _, p := range parts {
		evs, err := s.Feed(p)
		all = append(all, evs...)
		if err != nil {
			return all, err
		}
	}
	return all, s.Close()
}

func bytewise(doc string) []string {
	parts := make([]string, len(doc))
	for i := range len(doc) {
		parts[i] = doc[i : i+1]
	}
	return parts
}

// randomSplit cuts doc at random byte offsets (possibly inside a rune).
func randomSplit(doc string, r *rand.Rand) []string {
	var parts []string
	for len(doc) > 0 {
		n := 1 + r.IntN(len(doc))
		if n > 4 && r.IntN(2) == 0 {
			n = 1 + r.IntN(4)
		}
		parts = append(parts, doc[:n])
		doc = doc[n:]
	}
	return parts
}

// stringText collects the chunks and the end value for one path.
func stringText(t *testing.T, evs []Event, path string) (chunks []string, end string, ended bool) {
	t.Helper()
	for _, e := range evs {
		if e.Path.String() != path {
			continue
		}
		switch e.Kind {
		case StringChunk:
			if ended {
				t.Fatalf("%s: chunk after StringEnd", path)
			}
			if e.Text == "" {
				t.Fatalf("%s: empty chunk", path)
			}
			if !utf8.ValidString(e.Text) {
				t.Fatalf("%s: chunk is not valid UTF-8: %q", path, e.Text)
			}
			chunks = append(chunks, e.Text)
		case StringEnd:
			end, ended = e.Text, true
		}
	}
	return chunks, end, ended
}

func TestMainChunksThenEnd(t *testing.T) {
	s := New()
	first, err := s.Feed(`{"sourceLang":"en","main":"안녕`)
	if err != nil {
		t.Fatal(err)
	}
	chunks, _, ended := stringText(t, first, "main")
	if ended {
		t.Fatal("StringEnd main fired before the closing quote")
	}
	if !reflect.DeepEqual(chunks, []string{"안녕"}) {
		t.Fatalf("first chunks = %q", chunks)
	}
	if _, end, ok := stringText(t, first, "sourceLang"); !ok || end != "en" {
		t.Fatalf("sourceLang end = %q, %v", end, ok)
	}

	second, err := s.Feed(`하세요"}`)
	if err != nil {
		t.Fatal(err)
	}
	chunks, end, ended := stringText(t, second, "main")
	if !reflect.DeepEqual(chunks, []string{"하세요"}) || !ended || end != "안녕하세요" {
		t.Fatalf("second: chunks=%q end=%q ended=%v", chunks, end, ended)
	}
	// Order on the closing quote: last chunk, StringEnd, ValueEnd main, ValueEnd root.
	var kinds []string
	for _, e := range second {
		kinds = append(kinds, e.Kind.String()+" "+e.Path.String())
	}
	want := []string{"StringChunk main", "StringEnd main", "ValueEnd main", "ValueEnd "}
	if !reflect.DeepEqual(kinds, want) {
		t.Fatalf("second events = %q, want %q", kinds, want)
	}
	if got := string(second[2].Raw); got != `"안녕하세요"` {
		t.Fatalf("main raw = %s", got)
	}
	if got := string(second[3].Raw); got != `{"sourceLang":"en","main":"안녕하세요"}` {
		t.Fatalf("root raw = %s", got)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestEscapesSplitAcrossFeeds(t *testing.T) {
	const want = "a\"bé😀"
	splits := map[string][]string{
		"brief":    {`{"main":"a\`, `"b\u00`, `e9\uD83D`, `\uDE00"}`},
		"bytewise": bytewise(`{"main":"a\"b\u00e9\uD83D\uDE00"}`),
	}
	r := rand.New(rand.NewPCG(7, 7))
	for i := range 200 {
		splits[fmt.Sprint("random", i)] = randomSplit(`{"main":"a\"b\u00e9\uD83D\uDE00"}`, r)
	}
	for name, parts := range splits {
		evs, err := feedAll(parts...)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		chunks, end, ended := stringText(t, evs, "main")
		if got := strings.Join(chunks, ""); got != want || end != want || !ended {
			t.Fatalf("%s: chunks=%q end=%q ended=%v", name, chunks, end, ended)
		}
	}

	// A surrogate pair split byte-by-byte yields nothing until the last hex digit.
	s := New()
	if _, err := s.Feed(`{"main":"`); err != nil {
		t.Fatal(err)
	}
	pair := `\uD83D\uDE00`
	for i := range len(pair) {
		evs, err := s.Feed(pair[i : i+1])
		if err != nil {
			t.Fatal(err)
		}
		if i < len(pair)-1 && len(evs) != 0 {
			t.Fatalf("byte %d emitted %v", i, evs)
		}
		if i == len(pair)-1 && (len(evs) != 1 || evs[0].Text != "😀") {
			t.Fatalf("final byte emitted %v", evs)
		}
	}
}

func TestOtherEscapesAndUTF8Splits(t *testing.T) {
	doc := `{"main":"x\\y\nz\/\t\r\b\f\u0041한😀"}`
	want := "x\\y\nz/\t\r\b\fA한😀"
	for _, parts := range [][]string{{doc}, bytewise(doc)} {
		evs, err := feedAll(parts...)
		if err != nil {
			t.Fatal(err)
		}
		chunks, end, _ := stringText(t, evs, "main")
		if strings.Join(chunks, "") != want || end != want {
			t.Fatalf("chunks=%q end=%q", chunks, end)
		}
	}
}

func TestValueEndForArrayItems(t *testing.T) {
	doc := `{"main":"hi","alternatives":[{"text":"a","note":"n0"},{"text":"b","note":"n1"}]}`
	evs, err := feedAll(doc)
	if err != nil {
		t.Fatal(err)
	}
	var item, note1 *Event
	for i := range evs {
		e := &evs[i]
		if e.Kind == ValueEnd && e.Path.String() == "alternatives[0]" {
			item = e
		}
		if e.Kind == StringEnd && e.Path.String() == "alternatives[1].note" {
			note1 = e
		}
	}
	if item == nil || note1 == nil || note1.Text != "n1" {
		t.Fatalf("missing events: item=%v note1=%v", item, note1)
	}
	var got struct {
		Text string `json:"text"`
		Note string `json:"note"`
	}
	if err := json.Unmarshal(item.Raw, &got); err != nil {
		t.Fatal(err)
	}
	if got.Text != "a" || got.Note != "n0" {
		t.Fatalf("item = %+v", got)
	}
	wantPath := Path{{Key: "alternatives"}, {Index: 1, IsIndex: true}, {Key: "note"}}
	if !reflect.DeepEqual(note1.Path, wantPath) {
		t.Fatalf("path = %#v", note1.Path)
	}
}

func TestNoReadyOnPartial(t *testing.T) {
	for _, parts := range [][]string{
		{`{"main":"안녕하`},
		{`{"main":"abc\`},
		{`{"main":"abc\u00`},
		{`{"main":"abc\uD83D`},
		{`{"main":"abc`, "\xed\x95"}, // partial UTF-8 of 한
	} {
		s := New()
		var evs []Event
		for _, p := range parts {
			e, err := s.Feed(p)
			if err != nil {
				t.Fatalf("%q: %v", parts, err)
			}
			evs = append(evs, e...)
		}
		for _, e := range evs {
			if e.Kind != StringChunk {
				t.Fatalf("%q: unexpected %v %s", parts, e.Kind, e.Path)
			}
		}
		if err := s.Close(); err == nil {
			t.Fatalf("%q: Close accepted an incomplete document", parts)
		}
	}
}

func TestScalarsAndWhitespace(t *testing.T) {
	doc := " \n{ \"n\" : -1.5e3 ,\t\"t\":true,\"f\":false,\"z\":null,\r\n \"a\":[ 1 , 0 ],\"e\":[],\"o\":{} } \n"
	evs, err := feedAll(bytewise(doc)...)
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	for _, e := range evs {
		if e.Kind == ValueEnd {
			got = append(got, e.Path.String()+"="+string(e.Raw))
		}
	}
	want := []string{
		"n=-1.5e3", "t=true", "f=false", "z=null",
		"a[0]=1", "a[1]=0", "a=[ 1 , 0 ]", "e=[]", "o={}",
		"=" + strings.TrimSpace(doc),
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("ValueEnds:\n got %q\nwant %q", got, want)
	}
}

func TestRawReplacementCharacter(t *testing.T) {
	doc := "{\"main\":\"a\xef\xbf\xbdb\"}"
	if !jsontext.Value(doc).IsValid() {
		t.Fatal("test document should be valid JSON")
	}
	for _, parts := range [][]string{{doc}, bytewise(doc)} {
		evs, err := feedAll(parts...)
		if err != nil {
			t.Fatal(err)
		}
		if _, end, _ := stringText(t, evs, "main"); end != "a�b" {
			t.Fatalf("end = %q", end)
		}
	}
}

func TestNestingDepthMatchesJSONText(t *testing.T) {
	for _, n := range []int{maxDepth - 1, maxDepth, maxDepth + 1} {
		doc := strings.Repeat("[", n) + strings.Repeat("]", n)
		_, err := feedAll(doc)
		if valid := jsontext.Value(doc).IsValid(); valid != (err == nil) {
			t.Errorf("depth %d: jsontext valid=%v, scanner err=%v", n, valid, err)
		}
	}
}

func TestInvalidDocuments(t *testing.T) {
	for _, doc := range []string{
		``, ` `, `{`, `}`, `{"a":01}`, `{"a" 1}`, `{"a":tru}`, `{"a":truex}`, `{"a":1.}`,
		`{"a":-}`, `{"a":1e}`, "{\"a\":\"\x01\"}", `{"a":"\uD83D"}`, `{"a":"\uDE00"}`,
		`{"a":"\uD83Dx"}`, `{"a":"\uD83D\u0041"}`, "{\"a\":\"\xff\"}", "{\"a\":\"\xed\xa0\x80\"}",
		`{"a":1} x`, `{"a":1}{}`, `[1,]`, `{,}`, `{"a":1,}`, `[}`, `{]`, `{"a":"\x"}`,
		`{"a":"\u00g0"}`, `{1:2}`, `{"a"}`, `{"a":}`, `[1 2]`, `"abc`, "\xef\xbb\xbf{}",
	} {
		if _, err := feedAll(doc); err == nil {
			t.Errorf("%q: no error", doc)
		}
		if _, err := feedAll(bytewise(doc)...); err == nil {
			t.Errorf("%q bytewise: no error", doc)
		}
		if jsontext.Value(doc).IsValid() {
			t.Errorf("%q: test case is valid JSON", doc)
		}
	}
}

func TestErrorsAreSticky(t *testing.T) {
	s := New()
	if _, err := s.Feed(`{"a":x`); err == nil {
		t.Fatal("want error")
	}
	if _, err := s.Feed(`1}`); err == nil {
		t.Fatal("error was not sticky")
	}
	if err := s.Close(); err == nil {
		t.Fatal("Close after error returned nil")
	}
}

func TestRootScalars(t *testing.T) {
	for _, doc := range []string{`"x"`, `true`, ` null `, `12`, `[]`} {
		if _, err := feedAll(bytewise(doc)...); err != nil {
			t.Errorf("%q: %v", doc, err)
		}
	}
}

func TestPathString(t *testing.T) {
	cases := map[string]Path{
		"":                     nil,
		"main":                 {{Key: "main"}},
		"[2]":                  {{Index: 2, IsIndex: true}},
		"alternatives[0].note": {{Key: "alternatives"}, {Index: 0, IsIndex: true}, {Key: "note"}},
		"a.b[1][3]":            {{Key: "a"}, {Key: "b"}, {Index: 1, IsIndex: true}, {Index: 3, IsIndex: true}},
	}
	for want, p := range cases {
		if got := p.String(); got != want {
			t.Errorf("%#v.String() = %q, want %q", p, got, want)
		}
	}
}

// coalesce merges adjacent StringChunk events for the same path, so chunk
// granularity (which legitimately depends on feed boundaries) is ignored.
func coalesce(evs []Event) []Event {
	var out []Event
	for _, e := range evs {
		if n := len(out); n > 0 && e.Kind == StringChunk && out[n-1].Kind == StringChunk &&
			out[n-1].Path.String() == e.Path.String() {
			out[n-1].Text += e.Text
			continue
		}
		out = append(out, e)
	}
	return out
}

func FuzzFeedSplits(f *testing.F) {
	for _, seed := range []string{
		`{"sourceLang":"en","main":"안녕하세요","alternatives":[{"text":"a","note":"n"}]}`,
		`{"main":"a\"b\u00e9\uD83D\uDE00","x":[1,-2.5e+3,true,false,null,{},[]]}`,
		` [ "\\", "\/", "\n\t\r\b\f", 0, 10 ] `,
		`{"a":"😀한\u0000"}`,
		`{"a":01}`,
		"{\"a\":[\"\xef\xbf\xbd\",\"\\uFFFD\"]}",
		`"lone"`,
	} {
		f.Add(seed, uint64(1))
	}
	f.Fuzz(func(t *testing.T, doc string, seed uint64) {
		whole, wholeErr := feedAll(doc)
		valid := jsontext.Value(doc).IsValid(jsontext.AllowDuplicateNames(true))
		if valid != (wholeErr == nil) {
			t.Fatalf("validity mismatch for %q: jsontext=%v scanner err=%v", doc, valid, wholeErr)
		}
		split, splitErr := feedAll(randomSplit(doc, rand.New(rand.NewPCG(seed, seed^0x9e37)))...)
		if (splitErr == nil) != (wholeErr == nil) {
			t.Fatalf("error mismatch: whole=%v split=%v", wholeErr, splitErr)
		}
		if wholeErr != nil {
			return
		}
		if a, b := coalesce(whole), coalesce(split); !reflect.DeepEqual(a, b) {
			t.Fatalf("events differ for %q:\nwhole %v\nsplit %v", doc, a, b)
		}
		for _, evs := range [][]Event{whole, split} {
			text := map[string]string{}
			for _, e := range evs {
				if !utf8.ValidString(e.Text) {
					t.Fatalf("invalid UTF-8 text %q", e.Text)
				}
				p := e.Path.String()
				switch e.Kind {
				case StringChunk:
					text[p] += e.Text
				case StringEnd:
					if text[p] != e.Text {
						t.Fatalf("%s: chunks %q != end %q", p, text[p], e.Text)
					}
					delete(text, p)
				case ValueEnd:
					if !jsontext.Value(e.Raw).IsValid(jsontext.AllowDuplicateNames(true)) {
						t.Fatalf("%s: invalid raw %q", p, e.Raw)
					}
					if len(e.Raw) > 0 && e.Raw[0] == '"' {
						var s string
						if err := json.Unmarshal(e.Raw, &s); err != nil {
							t.Fatal(err)
						}
						if s != e.Text {
							t.Fatalf("%s: raw decodes to %q, StringEnd text %q", p, s, e.Text)
						}
					}
				}
			}
		}
	})
}
