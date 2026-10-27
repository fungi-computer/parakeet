import type { ClientContributionV1 } from "@fungi.computer/shiitake/client-entry";

import {
  type WhistleExecutionInput,
  type WhistleExecutionOutcome,
  type WhistleRuntime,
} from "@fungi.computer/whistle";
import type { ParakeetInteractions } from "../commands/interactions.js";
import { reportFailure } from "../lib/failure.js";
import type { ClientContribution } from "./client-contributions.js";

/** Action state belongs to the selected Session, never the rendered row. */
export type ClientActionState = Readonly<{
  /** The same advertised intent is already in flight. */
  pending: boolean;
  /** Visible execution failure; cleared when this intent is retried. */
  error?: string;
}>;

function advertisedActions(
  entry: ClientContribution,
): readonly NonNullable<ClientContributionV1["waiting"]>["cancel"][] {
  return [
    ...entry.value.panel.flatMap((row) => row.actions ?? []),
    ...entry.value.timeline.cells.flatMap((cell) =>
      cell.rows.flatMap((row) => row.actions ?? []),
    ),
    ...(entry.value.waiting === null ? [] : [entry.value.waiting.cancel]),
  ];
}

/** Run admitted row intents through the ordinary advertised Whistle commands. */
export function createClientActions(
  options: Readonly<{
    contributions: () => readonly ClientContribution[];
    online: () => boolean;
    commands: Pick<WhistleRuntime, "execute">;
    interactions: ParakeetInteractions;
  }>,
) {
  const controller = new AbortController();
  // Abort may change while the advertised command is awaiting its owner.
  const retired = () => controller.signal.aborted;
  const listeners = new Set<() => void>();
  let state: ReadonlyMap<
    NonNullable<ClientContributionV1["waiting"]>["cancel"],
    ClientActionState
  > = new Map();
  // Admission decodes fresh row objects on a committed slot change. Pending
  // work belongs to the advertised command intent, not that object's address.
  const intents = new Map<string, ClientActionState>();
  const key = (
    entryId: string,
    action: NonNullable<ClientContributionV1["waiting"]>["cancel"],
  ) => JSON.stringify([entryId, action.id, action.input ?? {}]);
  const refresh = () => {
    if (retired()) return;
    const current = new Map<
      NonNullable<ClientContributionV1["waiting"]>["cancel"],
      ClientActionState
    >();
    const visible = new Set<string>();
    for (const entry of options.contributions()) {
      for (const action of advertisedActions(entry)) {
        const id = key(entry.entryId, action);
        visible.add(id);
        const value = intents.get(id);
        if (value !== undefined) current.set(action, value);
      }
    }
    for (const [id, value] of intents)
      if (!visible.has(id) && !value.pending) intents.delete(id);
    state = current;
    for (const listener of listeners) listener();
  };
  const publish = (id: string, next: ClientActionState) => {
    if (retired()) return;
    intents.set(id, next);
    refresh();
  };
  return {
    snapshot: () => state,
    refresh,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    execute: async (
      entryId: string,
      action: NonNullable<ClientContributionV1["waiting"]>["cancel"],
      waiting = false,
    ): Promise<void> => {
      const entry = options
        .contributions()
        .find((value) => value.entryId === entryId);
      if (
        retired() ||
        !options.online() ||
        entry === undefined ||
        !advertisedActions(entry).includes(action) ||
        (waiting && entry.value.waiting?.cancel !== action)
      )
        return;
      const intent = key(entryId, action);
      if (intents.get(intent)?.pending) return;
      publish(intent, { pending: true });
      let outcome: WhistleExecutionOutcome;
      try {
        let input: WhistleExecutionInput = {
          origin: "menu",
          signal: controller.signal,
        };
        if (action.input !== undefined)
          input = { ...input, arguments: action.input };
        outcome = await options.commands.execute(
          `${entryId}:${action.id}`,
          input,
        );
      } catch (cause) {
        reportFailure("client row command", cause);
        if (retired()) return;
        const error =
          cause instanceof Error
            ? cause
            : new Error("Client row command failed", { cause });
        publish(intent, { pending: false, error: error.message });
        options.interactions.report({ tone: "error", message: error.message });
        return;
      }
      if (retired()) return;
      const error =
        outcome.status === "handled"
          ? undefined
          : outcome.status === "failed"
            ? outcome.error.message
            : outcome.status === "unavailable"
              ? outcome.reason
              : `Client row command ${outcome.status}`;
      publish(
        intent,
        error === undefined ? { pending: false } : { pending: false, error },
      );
      if (error !== undefined)
        options.interactions.report({ tone: "error", message: error });
    },
    dispose: () => {
      controller.abort();
      state = new Map();
      intents.clear();
      listeners.clear();
    },
  };
}
