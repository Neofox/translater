// Package llm wraps openai-go for the translator: it sends the prebuilt
// Responses request body, streams output-text deltas, and classifies
// provider failures. No hand-rolled HTTP or SSE: openai-go does both.
package llm

import (
	"context"
	"encoding/json/v2"
	"errors"
	"iter"
	"net/http"
	"strings"

	"github.com/openai/openai-go/v3"
	"github.com/openai/openai-go/v3/option"
	"github.com/openai/openai-go/v3/packages/ssestream"
	"github.com/openai/openai-go/v3/responses"
)

// Kind is the failure category shown to the user.
type Kind string

const (
	KindConfiguration      Kind = "configuration"
	KindAuthentication     Kind = "authentication"
	KindBudget             Kind = "budget"
	KindRateLimit          Kind = "rate_limit"
	KindModelConfiguration Kind = "model_configuration"
	KindStructuredOutput   Kind = "structured_output"
	KindProvider           Kind = "provider"
)

// ErrMissingAPIKey is yielded when OPENAI_API_KEY is empty at call time.
var ErrMissingAPIKey = errors.New("llm: OPENAI_API_KEY is not set")

// ErrIncomplete: the provider ended the response early (token limit, content
// filter), so the structured output cannot be parsed. Kind structured_output.
var ErrIncomplete = &failure{kind: KindStructuredOutput, text: "response incomplete"}

// ErrTruncated: the stream ended without response.completed. Kind provider.
var ErrTruncated = &failure{kind: KindProvider, text: "stream ended before completion"}

// failure is a content-free error: it carries a Kind and fixed text only.
// Provider errors (openai.Error, ssestream.StreamError) embed the raw
// provider body in Error(), so StreamText never yields them as-is.
type failure struct {
	kind Kind
	text string
}

func (f *failure) Error() string { return "llm: " + f.text + " (" + string(f.kind) + ")" }

func codeFailure(code string) error {
	switch code {
	case "insufficient_quota":
		return &failure{KindBudget, "provider error"}
	case "rate_limit_exceeded":
		return &failure{KindRateLimit, "provider error"}
	}
	return &failure{KindProvider, "provider error"}
}

// Client sends Responses requests. The API key is read per request.
type Client struct {
	getenv func(string) string
	oai    openai.Client
}

// New builds a client with retries disabled (a paid retry needs an explicit
// user action). OPENAI_BASE_URL, when set, overrides the endpoint.
func New(getenv func(string) string) *Client {
	opts := []option.RequestOption{option.WithMaxRetries(0)}
	if u := getenv("OPENAI_BASE_URL"); u != "" {
		opts = append(opts, option.WithBaseURL(u))
	}
	return &Client{getenv: getenv, oai: openai.NewClient(opts...)}
}

// StreamText posts body (a complete Responses request that already contains
// "stream":true) and yields each response.output_text.delta. The SDK's
// NewStreaming sets "stream" on the supplied body in place, so the bytes on
// the wire equal body. OPENAI_BASE_URL must include the version path (/v1).
// A cancelled ctx stops the stream and yields context.Canceled (or the
// deadline error): callers must check ctx.Err()/errors.Is before Classify.
// Every yielded error is content-free (safe to log); use Classify for its Kind.
func (c *Client) StreamText(ctx context.Context, body []byte) iter.Seq2[string, error] {
	return func(yield func(string, error) bool) {
		key := c.getenv("OPENAI_API_KEY")
		if key == "" {
			yield("", ErrMissingAPIKey)
			return
		}
		stream := c.oai.Responses.NewStreaming(ctx, responses.ResponseNewParams{},
			option.WithRequestBody("application/json", body),
			option.WithAPIKey(key))
		defer stream.Close()
		completed := false
		for stream.Next() {
			ev := stream.Current()
			switch ev.Type {
			case "response.output_text.delta":
				if !yield(ev.Delta, nil) {
					return
				}
			case "response.completed":
				completed = true
			case "error":
				yield("", codeFailure(ev.Code))
				return
			case "response.failed":
				yield("", codeFailure(string(ev.Response.Error.Code)))
				return
			case "response.incomplete":
				yield("", ErrIncomplete)
				return
			}
		}
		if err := stream.Err(); err != nil {
			yield("", sanitize(err))
			return
		}
		if err := ctx.Err(); err != nil {
			yield("", err)
			return
		}
		if !completed {
			yield("", ErrTruncated)
		}
	}
}

// Speech posts one text-to-speech request (POST /audio/speech) and returns
// the raw response; the caller closes its body. The API key is read per
// request (ErrMissingAPIKey when empty) and retries stay disabled. Errors are
// returned as the SDK reports them and may contain provider text: callers
// classify them and never log or show them.
func (c *Client) Speech(ctx context.Context, params openai.AudioSpeechNewParams) (*http.Response, error) {
	key := c.getenv("OPENAI_API_KEY")
	if key == "" {
		return nil, ErrMissingAPIKey
	}
	return c.oai.Audio.Speech.New(ctx, params, option.WithAPIKey(key), option.WithMaxRetries(0))
}

// sanitize drops provider text from SDK errors. Context errors pass through.
func sanitize(err error) error {
	var se *ssestream.StreamError
	if errors.As(err, &se) { // an `error` object event, intercepted by the SDK
		return codeFailure(streamErrorCode(se.Event.Data))
	}
	var apiErr *openai.Error
	if errors.As(err, &apiErr) {
		return &failure{Classify(err), "provider error"}
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return err
	}
	return &failure{KindProvider, "transport error"}
}

func streamErrorCode(data []byte) string {
	var e struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	_ = json.Unmarshal(data, &e)
	return e.Error.Code
}

// Classify maps an error from StreamText to a Kind. Only status and error
// code are inspected, never message or raw body.
func Classify(err error) Kind {
	if errors.Is(err, ErrMissingAPIKey) {
		return KindConfiguration
	}
	var f *failure
	if errors.As(err, &f) {
		return f.kind
	}
	var apiErr *openai.Error
	if !errors.As(err, &apiErr) {
		return KindProvider
	}
	switch apiErr.StatusCode {
	case http.StatusUnauthorized, http.StatusForbidden:
		return KindAuthentication
	case http.StatusPaymentRequired:
		return KindBudget
	case http.StatusTooManyRequests:
		if strings.Contains(apiErr.Code, "insufficient_quota") || strings.Contains(apiErr.Type, "insufficient_quota") {
			return KindBudget
		}
		return KindRateLimit
	case http.StatusBadRequest, http.StatusNotFound:
		return KindModelConfiguration
	}
	return KindProvider
}
