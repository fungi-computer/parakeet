import type {
  WhistleInteractionEnd,
  WhistlePresenter,
  WhistleRuntime,
} from "@fungi.computer/whistle";
import {
  createWhistleInteractionHost,
  type WhistleInteractionHost,
} from "@fungi.computer/whistle/interaction";

/** One interaction a renderer should draw as a dialog or panel. */
export type ParakeetOpenInteraction = Readonly<{
  /** Changes whenever a different interaction opens. */
  key: number;
  /** The renderer-neutral interaction store to draw. */
  host: WhistleInteractionHost;
  /** Run the same command again with the same input. */
  retry: () => void;
}>;

/** A one-line result shown beside the composer instead of a dialog. */
export type ParakeetNotice = Readonly<{
  /** How to color it. */
  tone: "info" | "success" | "error";
  /** What happened. */
  message: string;
}>;

/** Everything a renderer draws for command conversations. */
export type ParakeetInteractionState = Readonly<{
  /** The interaction that needs the human, when one does. */
  open?: ParakeetOpenInteraction | undefined;
  /** A manually opened, live panel row from an admitted client entry. */
  inspection?:
    | Readonly<{
        /** Composition-root identity of the admitted client entry. */
        entryId: string;
        /** Stable identity of the panel row being inspected. */
        rowId: string;
      }>
    | undefined;
  /** The latest one-line result. */
  notice?: ParakeetNotice | undefined;
}>;

/** Parakeet's command conversation store, shared by every renderer. */
export type ParakeetInteractions = Readonly<{
  /** Current state. */
  snapshot: () => ParakeetInteractionState;
  /** Observe changes. */
  subscribe: (listener: () => void) => () => void;
  /** Dismiss the open interaction, cancelling it if it is still running. */
  close: () => void;
  /** Open or dismiss an admitted panel inspection without starting a command. */
  inspect: (inspection: ParakeetInteractionState["inspection"]) => void;
  /** Replace or clear the one-line notice, starting a new command turn. */
  report: (notice: ParakeetNotice | undefined) => void;
  /** Become the runtime's presenter until the returned disposer runs. */
  attach: (present: WhistleRuntime["present"]) => () => void;
  /** How the most recent interaction ended; a dismissal is not a failure to report. */
  lastEnd: () => WhistleInteractionEnd["status"] | undefined;
}>;

/**
 * Own how commands talk to the human. An interaction opens only when it asks
 * a question, hands off to a URL or shows progress; a command that just
 * reports a result leaves a one-line notice instead of a dialog.
 */
export function createParakeetInteractions(): ParakeetInteractions {
  let state: ParakeetInteractionState = {};
  let sequence = 0;
  let lastEnd: WhistleInteractionEnd["status"] | undefined;
  const listeners = new Set<() => void>();
  const publish = (next: ParakeetInteractionState) => {
    state = next;
    for (const listener of listeners) listener();
  };
  const closeKey = (key: number) => {
    if (state.open?.key === key) publish({ ...state, open: undefined });
  };
  const presenter: WhistlePresenter = ({ title, retry }) => {
    const key = ++sequence;
    let shown = false;
    const host = createWhistleInteractionHost({
      title,
      onEnd: (end) => {
        lastEnd = end.status;
        const message = host.snapshot().message;
        if (!shown) {
          if (end.status === "failed")
            publish({
              ...state,
              notice: { tone: "error", message: end.message },
            });
          else if (message !== undefined && message.type !== "progress")
            publish({
              ...state,
              notice: {
                tone: message.type === "success" ? "success" : "info",
                message: message.message,
              },
            });
          return;
        }
        const lingers =
          end.status === "failed" ||
          (end.status === "handled" &&
            message !== undefined &&
            message.type !== "progress");
        if (!lingers) closeKey(key);
      },
    });
    const unsubscribe = host.subscribe(() => {
      if (shown) return;
      const current = host.snapshot();
      if (
        current.prompt === undefined &&
        current.handoff === undefined &&
        current.message?.type !== "progress"
      )
        return;
      shown = true;
      const previous = state.open;
      publish({ ...state, open: { key, host, retry }, notice: undefined });
      previous?.host.cancel();
    });
    const session = host.begin();
    return {
      interaction: session.interaction,
      settle: (end) => {
        unsubscribe();
        session.settle(end);
      },
    };
  };
  return {
    snapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    close: () => {
      const open = state.open;
      if (open === undefined) return;
      publish({ ...state, open: undefined });
      open.host.cancel();
    },
    inspect: (inspection) => {
      publish({ ...state, inspection });
    },
    report: (notice) => {
      // A new report starts a new turn: forget how the last interaction ended.
      lastEnd = undefined;
      publish({ ...state, notice });
    },
    attach: (present) => present(presenter),
    lastEnd: () => lastEnd,
  };
}
