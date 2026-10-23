import type {
  WhistleInteractionEnd,
  WhistlePresenter,
  WhistleRuntime,
} from "@fungi.computer/whistle";
import {
  createWhistleInteractionHost,
  type WhistleInteractionHost,
  type WhistleMessageNotice,
} from "@fungi.computer/whistle/interaction";

/** One interaction a renderer should draw as a dialog or panel. */
export type ParakeetOpenInteraction = Readonly<{
  /** Changes whenever a different interaction opens. */
  key: number;
  /** The renderer-neutral interaction store to draw. */
  host: WhistleInteractionHost;
}>;

/**
 * An attention item shown beside the composer until it is resolved: something
 * failed or waits on the person. Everything else is a toast.
 */
export type ParakeetNotice = Readonly<{
  /** How to color it. */
  tone: "info" | "error";
  /** What happened. */
  message: string;
}>;

/**
 * A transient message a renderer shows as a toast. A command's confirmation of
 * what the person just did is never one: it is an echo and is not announced.
 */
export type ParakeetToast = Readonly<{
  /** How to color it. */
  variant: "info" | "warning" | "error";
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
  /** The latest attention item: it stays until the person resolves it. */
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
  /** Replace or clear the attention notice, starting a new command turn. */
  report: (notice: ParakeetNotice | undefined) => void;
  /** Announce a transient message to every toast subscriber. */
  toast: (toast: ParakeetToast) => void;
  /** Receive transient messages; the renderer decides how to show them. */
  subscribeToasts: (listener: (toast: ParakeetToast) => void) => () => void;
  /** Become the runtime's presenter until the returned disposer runs. */
  attach: (present: WhistleRuntime["present"]) => () => void;
  /** How the most recent interaction ended; a dismissal is not a failure to report. */
  lastEnd: () => WhistleInteractionEnd["status"] | undefined;
}>;

/**
 * Own how commands talk to the human. An interaction opens only when it asks
 * a question, hands off to a URL or shows progress; a command that just
 * reports information emits a toast; ordinary success echoes are silent.
 */
export function createParakeetInteractions(): ParakeetInteractions {
  let state: ParakeetInteractionState = {};
  let sequence = 0;
  let lastEnd: WhistleInteractionEnd["status"] | undefined;
  const listeners = new Set<() => void>();
  const toastListeners = new Set<(toast: ParakeetToast) => void>();
  const toast = (next: ParakeetToast) => {
    for (const listener of toastListeners) listener(next);
  };
  /** Information is a toast; a success only echoes what the person did. */
  const announce = (message: WhistleMessageNotice) => {
    if (message.type === "info")
      toast({ variant: "info", message: message.message });
  };
  const publish = (next: ParakeetInteractionState) => {
    state = next;
    for (const listener of listeners) listener();
  };
  const closeKey = (key: number) => {
    if (state.open?.key === key) publish({ ...state, open: undefined });
  };
  const presenter: WhistlePresenter = ({ title }) => {
    const key = ++sequence;
    let shown = false;
    let hadRetryableFailure = false;
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
          else if (message !== undefined) announce(message);
          return;
        }
        // A retried result stays in the same notice row until Done. A
        // progress-only ending is not a completion notice to manufacture.
        if (
          end.status === "handled" &&
          hadRetryableFailure &&
          message !== undefined &&
          message.type !== "progress"
        )
          return;
        const closing = host.snapshot().closing;
        if (end.status === "cancelled" && closing !== undefined)
          announce(closing);
        if (end.status === "handled" && message !== undefined)
          announce(message);
        // Failed interactions retain their failure UI; ordinary results never
        // leave a dialog behind just to confirm the completed action.
        if (end.status !== "failed") closeKey(key);
      },
    });
    const unsubscribe = host.subscribe(() => {
      const current = host.snapshot();
      if (current.retryable) hadRetryableFailure = true;
      if (shown) return;
      if (
        current.prompt === undefined &&
        current.handoff === undefined &&
        current.message?.type !== "progress"
      )
        return;
      shown = true;
      const previous = state.open;
      publish({ ...state, open: { key, host }, notice: undefined });
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
    toast,
    subscribeToasts: (listener) => {
      toastListeners.add(listener);
      return () => {
        toastListeners.delete(listener);
      };
    },
    attach: (present) => present(presenter),
    lastEnd: () => lastEnd,
  };
}
