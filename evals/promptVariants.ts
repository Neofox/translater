import {
  renderPrompt,
  sentenceSystem,
  sentenceSystemView,
} from '../src/server/prompts.ts'
import type { SentenceSystemContext } from '../src/server/prompts.ts'

// Candidate sentence instructions for A/B evals. Same few-shots, live blocks,
// schema and request options as production; only the system text differs.
// The wording lives in shared/translation/prompts/variants/*.mustache.

function lean(ctx: SentenceSystemContext, characters: boolean): string {
  return renderPrompt('variants/lean', {
    ...sentenceSystemView(ctx),
    leanCharacters: characters,
  })
}

export const SENTENCE_SYSTEMS = {
  production: sentenceSystem,
  lean: (ctx: SentenceSystemContext) => lean(ctx, true),
  'lean-nochars': (ctx: SentenceSystemContext) => lean(ctx, false),
} satisfies Record<string, (ctx: SentenceSystemContext) => string>

export type PromptVariant = keyof typeof SENTENCE_SYSTEMS
