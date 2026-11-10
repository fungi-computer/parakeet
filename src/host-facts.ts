import { createContext } from "react";

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

const modelFailure = /^Model request failed \(([a-z_]+)\)\./u;
const unfinishedRun = "This run couldn’t finish.";

/** A failed model run in plain words; `detail` is the stored text, kept for a details disclosure. */
export type PlainModelFailure = Readonly<{
  unreachable: boolean;
  /** No model provider is connected: the fix is setup, not a retry. */
  setup: boolean;
  /** The saved choice cannot run Agent tools; changing models is the fix. */
  toolsUnsupported: boolean;
  message: string;
  detail: string;
}>;

/** A run that failed, with the plain sentence for its cause; undefined for any other text. */
export function plainModelFailure(text: string): PlainModelFailure | undefined {
  if (text === unfinishedRun)
    return {
      unreachable: false,
      setup: false,
      toolsUnsupported: false,
      message: "The run couldn’t finish",
      detail: text,
    };
  const code = modelFailure.exec(text)?.[1];
  if (code === undefined) return undefined;
  if (code === "setup_required")
    return {
      unreachable: false,
      setup: true,
      toolsUnsupported: false,
      message: "No model is connected",
      detail: text,
    };
  if (code === "tools_unsupported")
    return {
      unreachable: false,
      setup: false,
      toolsUnsupported: true,
      message: "This model can’t use tools here. Pick one marked tools.",
      detail: text,
    };
  return code === "provider_unavailable"
    ? {
        unreachable: true,
        setup: false,
        toolsUnsupported: false,
        message: "Couldn’t reach the model",
        detail: text,
      }
    : {
        unreachable: false,
        setup: false,
        toolsUnsupported: false,
        message: "The model request failed",
        detail: text,
      };
}
