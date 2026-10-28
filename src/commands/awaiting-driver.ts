import { createWhistleInteractionHost } from "@fungi.computer/whistle/interaction";
import type {
  WhistleCommandKey,
  WhistleExecutionOutcome,
} from "@fungi.computer/whistle";
import { useEffect, useRef } from "react";

import type { ClientContribution } from "../core/client-contributions.js";
import type { ParakeetInteractions } from "./interactions.js";
import type { ParakeetCommandRuntime } from "./use-slash-commands.js";

type RowAction = NonNullable<
  ClientContribution["value"]["panel"][number]["actions"]
>[number];

type AwaitingRow = Readonly<{
  key: string;
  /** The row's command; a client row belongs to the extension named by its entry. */
  command: WhistleCommandKey;
  title: string;
  action: RowAction;
}>;

/** Footer rows whose action asks the person to decide in the composer. */
function awaitingRows(
  contributions: readonly ClientContribution[],
): readonly AwaitingRow[] {
  return contributions.flatMap(({ entryId, value }) =>
    value.panel.flatMap((row) =>
      (row.actions ?? [])
        .filter((action) => action.awaiting !== undefined)
        .map((action) => ({
          key: JSON.stringify([entryId, row.id]),
          command: { namespace: entryId, id: action.id },
          title: row.title,
          action,
        })),
    ),
  );
}

type Running = Readonly<{
  stop: () => void;
  failed: () => boolean;
}>;

function failure(outcome: WhistleExecutionOutcome): string | undefined {
  if (outcome.status === "handled") return undefined;
  if (outcome.status === "failed") return outcome.error.message;
  if (outcome.status === "unavailable") return outcome.reason;
  return `The question could not be opened (${outcome.status}).`;
}

/**
 * Open the conversation of every decision the Agent is waiting on, so its
 * first prompt can take over the composer without the person asking. Each row
 * runs its own advertised command once; the row leaving cancels it.
 */
export function useAwaitingDriver(
  options: Readonly<{
    enabled: boolean;
    commands: ParakeetCommandRuntime;
    store: ParakeetInteractions;
    contributions: readonly ClientContribution[];
    /** Session observation is live; nothing opens while it is not. */
    online: boolean;
    /** Counts requests to answer, which restart a conversation that failed. */
    requests: number;
    /** Changes whenever the runtime's commands do, so a late command is found. */
    commandsVersion: unknown;
  }>,
): void {
  const {
    enabled,
    commands,
    store,
    contributions,
    online,
    requests,
    commandsVersion,
  } = options;
  const running = useRef(new Map<string, Running>());
  const handled = useRef(requests);
  useEffect(() => {
    const wanted = new Map(
      (enabled && online ? awaitingRows(contributions) : []).map((row) => [
        row.key,
        row,
      ]),
    );
    const retry = handled.current !== requests;
    handled.current = requests;
    for (const [key, entry] of running.current)
      if (!wanted.has(key) || (retry && entry.failed())) {
        entry.stop();
        running.current.delete(key);
      }
    for (const row of wanted.values()) {
      if (running.current.has(row.key)) continue;
      const host = createWhistleInteractionHost({ title: row.title });
      const session = host.begin();
      const controller = new AbortController();
      let leave: (() => void) | undefined;
      let failed = false;
      const unsubscribe = host.subscribe(() => {
        if (leave === undefined && host.snapshot().prompt !== undefined)
          leave = store.awaiting.add({
            key: row.key,
            kind: "question",
            arrivedAt: Date.now(),
            host,
          });
      });
      const base = {
        origin: "menu",
        signal: controller.signal,
        interaction: session.interaction,
      } as const;
      void commands
        .execute(
          row.command,
          row.action.input === undefined
            ? base
            : { ...base, arguments: row.action.input },
        )
        .then((outcome) => {
          unsubscribe();
          leave?.();
          if (
            outcome.status === "missing" ||
            outcome.status === "unavailable"
          ) {
            // Its command is not advertised yet; start over when it is.
            session.settle({ status: "cancelled" });
            if (running.current.get(row.key)?.failed() === false)
              running.current.delete(row.key);
            return;
          }
          const message = failure(outcome);
          if (message === undefined) {
            session.settle({ status: "handled" });
            const notice = host.snapshot().message;
            if (notice?.type === "info")
              store.toast({ variant: "info", message: notice.message });
            return;
          }
          if (controller.signal.aborted) {
            session.settle({ status: "cancelled" });
            return;
          }
          failed = true;
          session.settle({ status: "failed", message });
          store.report({ tone: "error", message });
        });
      running.current.set(row.key, {
        failed: () => failed,
        stop: () => {
          unsubscribe();
          leave?.();
          controller.abort();
          host.cancel();
        },
      });
    }
  }, [
    enabled,
    online,
    contributions,
    commands,
    store,
    requests,
    commandsVersion,
  ]);
  useEffect(
    () => () => {
      for (const entry of running.current.values()) entry.stop();
      running.current.clear();
    },
    [commands, store, enabled],
  );
}
