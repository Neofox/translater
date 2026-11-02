// Package llm wraps openai-go for the translator: it sends the prebuilt
// Responses request body, streams output-text deltas, and classifies
// provider failures. No hand-rolled HTTP or SSE: openai-go does both.
package llm

import (
	"context"
	"errors"
	"iter"
	"net/http"
	"strings"

	"github.com/openai/openai-go/v3"
	"github.com/openai/openai-go/v3/option"
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

// errStream marks a failure reported inside the stream. It carries no
// provider text: raw provider errors are never logged or surfaced.
var errStream = errors.New("llm: provider reported a stream failure")

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
// the wire equal body. A cancelled ctx stops the stream and yields ctx.Err().
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
		for stream.Next() {
			ev := stream.Current()
			switch ev.Type {
			case "response.output_text.delta":
				if !yield(ev.Delta, nil) {
					return
				}
			case "error", "response.failed", "response.incomplete":
				yield("", errStream)
				return
			}
		}
		if err := stream.Err(); err != nil {
			yield("", err)
			return
		}
		if err := ctx.Err(); err != nil {
			yield("", err)
		}
	}
}

// Classify maps an error from StreamText to a Kind. Only status and error
// code are inspected, never message or raw body.
func Classify(err error) Kind {
	if errors.Is(err, ErrMissingAPIKey) {
		return KindConfiguration
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
