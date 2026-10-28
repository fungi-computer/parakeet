import { createWhistleInteractionHost } from "@fungi.computer/whistle/interaction";
import { useEffect, useRef, useSyncExternalStore } from "react";

import { askApproval, type ApprovalSource } from "./core/approval-decision.js";
import type { ParakeetInteractions } from "./commands/interactions.js";

const noApproval = () => undefined;
const noSubscription = () => () => undefined;

/**
 * Put one source's pending approval in the composer's queue. While the record
 * is answerable and the person is present it asks through decision prompts;
 * a changed revision replaces the item, so only the record on screen can be
 * answered. Esc postpones it: the record stays pending in the ledger.
 */
export function useApprovalAwaiting(
  options: Readonly<{
    source: ApprovalSource | undefined;
    store: ParakeetInteractions;
    /** Nothing is asked while this is false (observation not live, pane unfocused). */
    enabled: boolean;
    /** The person's home folder, which paths are shortened against. */
    home: string;
    /** Cells to shorten the card's text to. */
    width: number;
    /** The longest denial note. */
    noteLimit: number;
    /** An error that reached the person as a refusal. */
    onFailure: (cause: unknown) => void;
  }>,
): void {
  const { source, store, enabled, home, width, noteLimit, onFailure } = options;
  // Only a different record, revision or right restarts the question: a
  // resize, a fresh callback or a reread of the same revision must not move
  // the person back to the first choice or reorder the queue.
  const failure = useRef(onFailure);
  failure.current = onFailure;
  const layout = useRef({ home, width, noteLimit });
  layout.current = { home, width, noteLimit };
  const view = useSyncExternalStore(
    source?.subscribe ?? noSubscription,
    source?.snapshot ?? noApproval,
  );
  const shown = useRef(view);
  shown.current = view;
  const key =
    view === undefined
      ? undefined
      : JSON.stringify([
          "approval",
          view.record.recordId,
          view.record.revision,
          view.canAnswer,
        ]);
  useEffect(() => {
    const view = shown.current;
    if (!enabled || source === undefined || view === undefined) return;
    if (!view.canAnswer || key === undefined) return;
    const { home, width, noteLimit } = layout.current;
    const host = createWhistleInteractionHost({ title: "Approval" });
    const session = host.begin();
    const stillCurrent = () => {
      const now = source.snapshot();
      return (
        !session.interaction.signal.aborted &&
        now?.record.recordId === view.record.recordId &&
        now.record.revision === view.record.revision &&
        now.canAnswer
      );
    };
    const leave = store.awaiting.add({
      key,
      kind: "approval",
      arrivedAt: Date.now(),
      host,
    });
    void askApproval(session.interaction, {
      view,
      source,
      home,
      width,
      now: Date.now(),
      noteLimit,
      stillCurrent,
      onFailure: (cause) => {
        failure.current(cause);
      },
    }).then((outcome) => {
      if (outcome.kind === "refused")
        // The refusal stays in the composer; the record rereads when it changes.
        session.settle({ status: "failed", message: outcome.message });
      else {
        leave();
        session.settle(
          outcome.kind === "answered"
            ? { status: "handled" }
            : { status: "cancelled" },
        );
      }
    });
    return () => {
      leave();
      host.cancel();
    };
  }, [source, key, enabled, store]);
}
