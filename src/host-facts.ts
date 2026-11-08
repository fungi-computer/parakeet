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

/** A model run that failed, with the plain sentence for its cause; undefined for any other text. */
export function plainModelFailure(
  text: string,
): Readonly<{ unreachable: boolean; message: string }> | undefined {
  const code = modelFailure.exec(text)?.[1];
  if (code === undefined) return undefined;
  return code === "provider_unavailable" || code === "setup_required"
    ? {
        unreachable: true,
        message: "The model provider couldn't be reached. Try again.",
      }
    : { unreachable: false, message: "The model request failed. Try again." };
}
