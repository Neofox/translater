// Command request prints the OpenAI Responses request body the app sends for
// one translation, for the quality evals (evals/translationProvider.ts),
// which post it to OpenAI themselves. It reads one JSON object on stdin,
//
//	{"input": {text, source, target, mode, intent, uiLang, context,
//	           refinements, previousMain},
//	 "config": {model, reasoning, serviceTier},
//	 "variant": "production" | "lean" | "lean-nochars"}
//
// and writes the body prompt.BuildVariant returns (stream: true, exactly the
// bytes the app sends) to stdout. config is validated like the
// TRANSLATE_* deployment variables (empty fields take their defaults);
// variant is optional (production).
//
// With -prepare it instead reads {"counterpart", "primary", "phrases"} (a
// sentence result's learningPhrases) and prints what learning.Prepare
// resolves: {"ok", "partial", "grammarHighlights"} (the number of resolved
// grammar ranges), for the deterministic eval checks (evals/checks.ts).
//
// No network, no environment: a failure exits 1 with the reason on stderr.
package main

import (
	"encoding/json/v2"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"

	"neotranslate/internal/config"
	"neotranslate/internal/contract"
	"neotranslate/internal/learning"
	"neotranslate/internal/prompt"
)

type request struct {
	Input  prompt.TranslateInput `json:"input"`
	Config struct {
		Model       string `json:"model"`
		Reasoning   string `json:"reasoning"`
		ServiceTier string `json:"serviceTier"`
	} `json:"config"`
	Variant string `json:"variant"`
}

type prepareInput struct {
	Counterpart string            `json:"counterpart"`
	Primary     string            `json:"primary"`
	Phrases     []learning.Phrase `json:"phrases"`
}

type prepareOutput struct {
	OK                bool `json:"ok"`
	Partial           bool `json:"partial"`
	GrammarHighlights int  `json:"grammarHighlights"`
}

func main() {
	prepare := flag.Bool("prepare", false, "resolve learning phrases instead of building a request")
	flag.Parse()
	run := buildBody
	if *prepare {
		run = prepareLearning
	}
	if err := run(os.Stdin, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "request:", err)
		os.Exit(1)
	}
}

func buildBody(r io.Reader, w io.Writer) error {
	var req request
	if err := json.UnmarshalRead(r, &req, json.RejectUnknownMembers(true)); err != nil {
		return err
	}
	env := map[string]string{
		"TRANSLATE_MODEL":        req.Config.Model,
		"TRANSLATE_REASONING":    req.Config.Reasoning,
		"TRANSLATE_SERVICE_TIER": req.Config.ServiceTier,
	}
	cfg, err := config.LoadTranslate(func(k string) string { return env[k] })
	if err != nil {
		return err
	}
	c, err := contract.Load()
	if err != nil {
		return err
	}
	variant := req.Variant
	if variant == "" {
		variant = prompt.Production
	}
	body, err := prompt.BuildVariant(c, req.Input, cfg, variant)
	if err != nil {
		return err
	}
	_, err = w.Write(body)
	return err
}

func prepareLearning(r io.Reader, w io.Writer) error {
	var in prepareInput
	if err := json.UnmarshalRead(r, &in, json.RejectUnknownMembers(true)); err != nil {
		return err
	}
	if in.Phrases == nil {
		return errors.New("phrases is required")
	}
	p, ok := learning.Prepare(in.Counterpart, in.Primary, in.Phrases)
	out := prepareOutput{OK: ok, Partial: p.Partial}
	for _, c := range p.Chunks {
		out.GrammarHighlights += len(c.GrammarHighlights)
	}
	return json.MarshalWrite(w, out)
}
