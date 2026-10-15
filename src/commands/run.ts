import { nanoid } from "@fungi.computer/cairn";
import type {
  WhistleExecutionOrigin,
  WhistleExecutionOutcome,
  WhistleRuntime,
} from "@fungi.computer/whistle";
import { z } from "zod";

import { parseSlashDraft, slashRegistry } from "./slash.js";

/** The Whistle surface a composer needs to run drafts. */
export type SlashRuntime = Pick<WhistleRuntime, "snapshot" | "execute">;

type Pending = {
  draft: string;
  requestId: string;
  running?: Promise<WhistleExecutionOutcome> | undefined;
};
const pendingByRuntime = new WeakMap<object, Map<string, Pending>>();

/** Whether a handled command declined its input (for example a refused replacement). */
export function isCancelledOutcome(outcome: WhistleExecutionOutcome): boolean {
  if (outcome.status !== "handled") return false;
  return z.looseObject({ cancelled: z.literal(true) }).safeParse(outcome.result)
    .success;
}

/**
 * Run one composer draft: a prompt goes to `send`, a `/command` runs through
 * Whistle. A grammar that asks for a request id keeps the same id across
 * retries of the same draft until the command is handled.
 */
export async function runSlashDraft(
  draft: string,
  commands: SlashRuntime,
  send: () => void,
  origin: WhistleExecutionOrigin,
): Promise<WhistleExecutionOutcome | undefined> {
  const parsed = parseSlashDraft(slashRegistry(commands.snapshot()), draft);
  if (parsed.kind === "prompt") {
    send();
    return undefined;
  }
  if (parsed.kind === "invalid")
    return {
      status: "failed",
      error: { code: "invalid_arguments", message: parsed.message },
    };
  const { command, requestIdField } = parsed;
  if (parsed.arguments === undefined)
    return commands.execute(command.commandId, { origin });
  if (requestIdField === undefined)
    return commands.execute(command.commandId, {
      origin,
      arguments: parsed.arguments,
    });
  const states = pendingByRuntime.get(commands) ?? new Map<string, Pending>();
  pendingByRuntime.set(commands, states);
  const previous = states.get(command.commandId);
  if (previous?.draft === draft && previous.running !== undefined)
    return previous.running;
  const state: Pending = {
    draft,
    requestId: previous?.draft === draft ? previous.requestId : nanoid(),
  };
  states.set(command.commandId, state);
  const running = commands
    .execute(command.commandId, {
      origin,
      arguments: { ...parsed.arguments, [requestIdField]: state.requestId },
    })
    .then((outcome) => {
      if (states.get(command.commandId) !== state) return outcome;
      state.running = undefined;
      if (outcome.status === "handled" && !isCancelledOutcome(outcome))
        states.delete(command.commandId);
      return outcome;
    });
  state.running = running;
  return running;
}
