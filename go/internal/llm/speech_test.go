package llm_test

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/openai/openai-go/v3"

	"neotranslate/internal/fakeopenai"
	"neotranslate/internal/llm"
)

func speechParams(input string) openai.AudioSpeechNewParams {
	return openai.AudioSpeechNewParams{
		Model:          "gpt-4o-mini-tts",
		Voice:          openai.AudioSpeechNewParamsVoiceUnion{OfString: openai.String("marin")},
		Input:          input,
		ResponseFormat: openai.AudioSpeechNewParamsResponseFormatWAV,
	}
}

// Speech errors are content-free: the provider body never reaches the error
// text, and the kind stays classifiable.
func TestSpeechErrorIsContentFree(t *testing.T) {
	c, _ := setup(t)
	res, err := c.Speech(context.Background(), speechParams("PRIVATE-INPUT [fx:speech-error]"))
	if err == nil {
		res.Body.Close()
		t.Fatal("no error for a 500")
	}
	// openai.Error keeps the raw body (and request) in its fields, so it must
	// not be reachable: %#v or errors.As would expose the provider text.
	var apiErr *openai.Error
	if errors.As(err, &apiErr) {
		t.Errorf("the raw *openai.Error is reachable")
	}
	for _, text := range []string{err.Error(), fmt.Sprintf("%+v", err), fmt.Sprintf("%#v", err)} {
		for _, leak := range []string{fakeopenai.FaultMessage, "PRIVATE-INPUT", "server_error", "audio/speech"} {
			if strings.Contains(text, leak) {
				t.Errorf("error %q contains %q", text, leak)
			}
		}
	}
	if k := llm.Classify(err); k != llm.KindProvider {
		t.Errorf("kind = %s", k)
	}
}

func TestSpeechMissingKeyAndContextErrorsStayDetectable(t *testing.T) {
	c := llm.New(func(string) string { return "" })
	if _, err := c.Speech(context.Background(), speechParams("hi")); !errors.Is(err, llm.ErrMissingAPIKey) {
		t.Errorf("missing key: %v", err)
	}

	c, _ = setup(t)
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	_, err := c.Speech(ctx, speechParams("PRIVATE-INPUT [fx:speech-slow]"))
	if !errors.Is(err, context.DeadlineExceeded) || strings.Contains(err.Error(), "PRIVATE-INPUT") {
		t.Errorf("deadline: %v", err)
	}

	ctx, cancel = context.WithCancel(context.Background())
	cancel()
	if _, err := c.Speech(ctx, speechParams("hi")); !errors.Is(err, context.Canceled) {
		t.Errorf("canceled: %v", err)
	}
}
