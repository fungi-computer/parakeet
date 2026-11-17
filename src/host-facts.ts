import { createContext } from "react";
import { providerDisplayNames, type ModelFailure } from "@fungi.computer/mule";

/** Whether a model is connected, with the one fix the host offers. */
export type ParakeetModelSetup = Readonly<{
  /** `missing` turns a model failure into the setup notice; `unknown` leaves it a failure. */
  state: "ready" | "missing" | "unknown";
  /** Opens the host's model setup, such as Keys. Required: a notice never has a dead button. */
  fix: Readonly<{
    /** The button text, such as "Add a model key". */
    label: string;
    /** Called when the person chooses it. */
    onSelect: () => void;
  }>;
}>;

/** What the host knows that the conversation needs to speak plainly. */
export type ParakeetHostFacts = Readonly<{
  /** Absent means unknown: failures show as failures, never as setup. */
  modelSetup?: ParakeetModelSetup | undefined;
  /** False when the host has no billing, so no sentence promises or denies credits. Default true. */
  billing?: boolean | undefined;
  /** One-click prompts the empty conversation offers; each sends as written. */
  starters?: readonly string[] | undefined;
}>;

/** Provided by the conversation view; read by the failure and empty states. */
export const ParakeetHostFactsContext = createContext<ParakeetHostFacts>({});

const failureMessages: ReadonlyMap<ModelFailure["cause"]["code"], string> =
  new Map([
    ["setup_required", "No model is connected"],
    [
      "tools_unsupported",
      "This model can’t use tools here. Pick one marked tools.",
    ],
    ["provider_unavailable", "Couldn’t reach the model"],
    ["rate-limit", "The model provider is receiving too many requests"],
    ["overloaded", "The model provider is overloaded"],
    ["provider_rejected", "The model provider refused the request"],
    ["request_failed", "The model request failed"],
  ]);

/** A failed model run in plain words; `detail` is the stored text, kept for a details disclosure. */
export type PlainModelFailure = Readonly<{
  unreachable: boolean;
  /** No model provider is connected: the fix is setup, not a retry. */
  setup: boolean;
  /** The saved choice cannot run Agent tools; changing models is the fix. */
  toolsUnsupported: boolean;
  /** Exhausted usage or account quota cannot be fixed by retrying this request. */
  usageLimit: boolean;
  message: string;
  detail: string;
}>;

/** Describe typed failure facts; display text alone never supplies a cause or provider. */
export function plainModelFailure(
  failure: ModelFailure | undefined,
  text: string,
): PlainModelFailure | undefined {
  if (failure === undefined) return undefined;
  const base = {
    unreachable: false,
    setup: false,
    toolsUnsupported: false,
    usageLimit: false,
    detail: text,
  };
  const code = failure.cause.code;
  if (code === "usage-limit-reached") {
    const name = providerDisplayNames.get(failure.provider) ?? failure.provider;
    return {
      ...base,
      usageLimit: true,
      message: `${name} usage limit reached.`,
    };
  }
  return {
    ...base,
    unreachable: code === "provider_unavailable",
    setup: code === "setup_required",
    toolsUnsupported: code === "tools_unsupported",
    message: failureMessages.get(code) ?? "The model request failed",
  };
}
