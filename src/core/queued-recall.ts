import type {
  CancelResult,
  SessionPendingPrompt,
  ShiitakeSession,
} from "@fungi.computer/shiitake/client";

/** Ephemeral composer reservation, never an admission journal or queue. */
export type QueuedRecallState =
  | Readonly<{
      /** Whether recall is available, reserved, or restored into the composer. */
      kind: "idle" | "recalling" | "restored";
    }>
  | Readonly<{
      /** A definitive refusal or an unresolved owner response. */
      kind: "too_late" | "uncertain";
      /** Explanation suitable for the host's existing toast surface. */
      message: string;
    }>;

/** Result of one recall gesture; an empty queue permits local input history. */
export type QueuedRecallOutcome =
  "ignored" | "empty" | "restored" | "too_late" | "uncertain";

/** Composer boundary consumed by the queued-recall owner. */
export type RecallComposer = Readonly<{
  session: Pick<ShiitakeSession, "latestPending" | "cancel">;
  recovery: SessionPendingPrompt | undefined;
  /** Commit in the existing Session draft journal before cancellation can start. */
  reserve: (prompt: SessionPendingPrompt) => void;
  /** Clear that journal's reservation after a definitive TooLate. */
  forget: () => void;
  /** Undefined when text, attachments or a pending paste make recall unsafe. */
  emptyDraftRevision: () => number | undefined;
  /** Atomically restore the full payload iff this empty revision still owns input. */
  restore: (prompt: SessionPendingPrompt, revision: number) => boolean;
  /** Hosts use their existing toast seam and derive read-only from `recalling`. */
  onState: (state: QueuedRecallState) => void;
}>;

type Target = {
  readonly prompt: SessionPendingPrompt;
  result?: CancelResult;
};

type Decision =
  | Readonly<{ kind: "empty" }>
  | Readonly<{ kind: "ignored" }>
  | Readonly<{ kind: "decided"; target: Target; result: CancelResult }>
  | Readonly<{ kind: "uncertain"; message: string }>;

/** A private UI wait ceiling; it does not cancel or reinterpret owner work. */
const recallWaitMs = 5_000;
const tooLateMessage = "Too late: that message already started";

function failureMessage(cause: unknown): string {
  return cause instanceof Error
    ? cause.message
    : "Could not recall queued message";
}

export type QueuedRecall = Readonly<{
  readonly state: QueuedRecallState;
  recall: () => Promise<QueuedRecallOutcome>;
  dispose: () => void;
}>;

/** One instance belongs to one mounted Session composer, not a surface or Agent. */
export function createQueuedRecall(composer: RecallComposer): QueuedRecall {
  let state: QueuedRecallState = { kind: "idle" };
  let target: Target | undefined =
    composer.recovery === undefined ? undefined : { prompt: composer.recovery };
  let disposed = false;
  const isDisposed = () => disposed;
  let releaseWait: (() => void) | undefined;
  let pendingDecision: Promise<Decision> | undefined;
  const update = (next: QueuedRecallState) => {
    state = next;
    composer.onState(next);
  };

  async function decide(
    revision: number,
    attempt: Readonly<{ active: boolean }>,
  ): Promise<Decision> {
    if (target === undefined) {
      const prompt = await composer.session.latestPending();
      // A late lookup must never begin cancellation after input was unlocked.
      if (!attempt.active || isDisposed()) return { kind: "ignored" };
      if (composer.emptyDraftRevision() !== revision)
        return { kind: "ignored" };
      if (prompt === null) return { kind: "empty" };
      composer.reserve(prompt);
      target = { prompt };
    }
    const selected = target;
    const result =
      selected.result ??
      (await composer.session.cancel({
        commandId: selected.prompt.commandId,
        onlyIfPending: true,
      }));
    // An ambiguous timeout retains this result for a deliberate subsequent Up.
    // Never mutate another target or restore input from a late response.
    if (!isDisposed() && target === selected) selected.result = result;
    return { kind: "decided", target: selected, result };
  }

  async function recall(): Promise<QueuedRecallOutcome> {
    const revision = composer.emptyDraftRevision();
    if (isDisposed() || state.kind === "recalling" || revision === undefined)
      return "ignored";
    // A UI timeout cannot abort the owner's Promise. Do not accumulate hidden
    // requests or waiters while it is unsettled; another Up can recover its
    // result once it arrives, or retry this exact target after a rejection.
    if (pendingDecision !== undefined) return "uncertain";
    update({ kind: "recalling" });
    const attempt = { active: true };
    const interrupted = new Promise<Decision>((resolve) => {
      releaseWait = () => {
        resolve({ kind: "ignored" });
      };
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<Decision>((resolve) => {
      timer = setTimeout(() => {
        attempt.active = false;
        resolve({
          kind: "uncertain",
          message:
            "Recall is unconfirmed. Press Up on an empty composer to retry.",
        });
      }, recallWaitMs);
    });
    pendingDecision = decide(revision, attempt)
      .catch((cause: unknown): Decision => ({
        kind: "uncertain",
        message: failureMessage(cause),
      }))
      .finally(() => {
        pendingDecision = undefined;
      });
    const decision = await Promise.race([
      pendingDecision,
      timeout,
      interrupted,
    ]);
    attempt.active = false;
    clearTimeout(timer);
    releaseWait = undefined;
    if (isDisposed()) return "ignored";
    if (decision.kind === "ignored" || decision.kind === "empty") {
      update({ kind: "idle" });
      return decision.kind;
    }
    if (decision.kind === "uncertain") {
      update(decision);
      return "uncertain";
    }
    if (decision.result.status === "too_late") {
      try {
        composer.forget();
      } catch (cause) {
        update({ kind: "uncertain", message: failureMessage(cause) });
        return "uncertain";
      }
      target = undefined;
      update({ kind: "too_late", message: tooLateMessage });
      return "too_late";
    }
    try {
      if (composer.restore(decision.target.prompt, revision)) {
        target = undefined;
        update({ kind: "restored" });
        return "restored";
      }
      update({
        kind: "uncertain",
        message:
          "Message recalled. Clear the composer and press Up to restore it.",
      });
    } catch (cause) {
      // Keep the accepted payload if, for example, the existing draft journal
      // refused the restore. A later Up retries restoration, not cancellation.
      update({ kind: "uncertain", message: failureMessage(cause) });
    }
    return "uncertain";
  }

  return {
    get state() {
      return state;
    },
    recall,
    dispose: () => {
      disposed = true;
      releaseWait?.();
    },
  };
}
