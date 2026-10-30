import { ANTHROPIC_MODELS } from "@earendil-works/pi-ai/providers/anthropic.models";
import { CLOUDFLARE_WORKERS_AI_MODELS } from "@earendil-works/pi-ai/providers/cloudflare-workers-ai.models";
import { OPENAI_MODELS } from "@earendil-works/pi-ai/providers/openai.models";
import { OPENAI_CODEX_MODELS } from "@earendil-works/pi-ai/providers/openai-codex.models";
import type { ParakeetModel } from "../conversation.js";
import { formatModelIdentity } from "./model-identity.js";

// Read the same maintained metadata as the providers, without loading their
// execution/auth adapters or maintaining another table of display names.
const names = new Map<string, string>(
  [
    ...Object.values(ANTHROPIC_MODELS),
    ...Object.values(CLOUDFLARE_WORKERS_AI_MODELS),
    ...Object.values(OPENAI_MODELS),
    ...Object.values(OPENAI_CODEX_MODELS),
  ].map((model) => [
    formatModelIdentity({ provider: model.provider, model: model.id }),
    model.name,
  ]),
);

/** A maintained catalog label, or the real identity rather than a guessed name. */
export function composerModelName(model: ParakeetModel): string {
  const identity = formatModelIdentity(model);
  return names.get(identity) ?? identity;
}
