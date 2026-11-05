package learning

// Side is the text the learner analyses: "source" when translating into the
// UI language (the user's fluent language) from another language, "target"
// otherwise, including same-language polishing. Port of
// src/lib/learningSide.ts `learningSide`; callers pass the model-reported
// languages, falling back to the request's.
func Side(source, target, uiLang string) string {
	if target == uiLang && source != uiLang {
		return "source"
	}
	return "target"
}
