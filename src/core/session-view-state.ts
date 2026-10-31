import type {
  AgentRunningWork,
  SessionCompactionTrigger,
  SessionSnapshot,
} from "@fungi.computer/shiitake/client";
import { boundedDiagnostic } from "@fungi.computer/bird-dog/effect";
import stripAnsi from "strip-ansi";

/**
 * What a person's readout of one Session says, decided from Shiitake's raw
 * activity facts. Shiitake publishes facts; this module owns their meaning.
 */
export type SessionViewState =
  | Readonly<{
      /** Current activity presented to the person. */
      kind: "idle" | "waiting_for_you" | "thinking" | "responding";
    }>
  | Readonly<{
      /** Cancellation is waiting for current work to settle. */
      kind: "cancelling";
    }>
  | Readonly<{
      /** A compaction is running now, started by this trigger. */
      kind: "compacting";
      /** What started it: the user, the context threshold, or an overflow. */
      trigger: SessionCompactionTrigger;
    }>
  /**
   * The Session's accepted work has not started in the Agent. Cancelling
   * `queuedCommandId` with `onlyIfPending` withdraws the wait, or reports
   * `too_late` once the work has started.
   */
  | Readonly<{
      /** Accepted work is waiting in the Agent queue. */
      kind: "queued";
      /** Exact command that can be withdrawn before it starts. */
      queuedCommandId: string;
      /** Live work occupying the executor, or null while awaiting the host. */
      runningWork: AgentRunningWork | null;
    }>
  | Readonly<{
      /** Provider retry is scheduled. */
      kind: "retrying";
      /** Current retry attempt. */
      attempt: number;
      /** Maximum attempts allowed by the run policy. */
      maxAttempts: number;
      /** Bounded reason suitable for presentation. */
      cause: string;
      /** Scheduled retry time, in milliseconds since the epoch. */
      nextRetryAt: number;
    }>
  | Readonly<{
      /** One tool is running. */
      kind: "running_tool";
      /** Name of the active tool. */
      tool: string;
    }>
  | Readonly<{
      /** The latest terminal failed or was interrupted. */
      kind: "error";
      /** Redacted, bounded terminal diagnostic for presentation. */
      cause: string;
    }>;

/** The facts a view state is decided from. */
export type SessionViewFacts = Pick<
  SessionSnapshot,
  "activity" | "terminals" | "progress"
>;

/** Coarse activity of a Session, for composer gating. */
export type SessionActivityStatus =
  "cancelling" | "idle" | "queued" | "retrying" | "streaming" | "thinking";

const retryCauseLimit = 160;

function collapsed(text: string, limit: number): string {
  return text.replace(/\s+/gu, " ").trim().slice(0, limit);
}

function displayDiagnostic(text: string): string | undefined {
  // Recognize whole terminal programs before dropping individual controls:
  // otherwise OSC payloads become visible text after their ESC is removed.
  const safe = stripAnsi(text).replace(
    /[\p{Cc}\u200b\u200e\u200f\u061c\u202a-\u202e\u2066-\u2069\u2060\ufeff]/gu,
    (character) => (/\s/u.test(character) ? " " : ""),
  );
  return boundedDiagnostic(safe);
}

function idleViewState({
  activity,
  terminals,
}: SessionViewFacts): SessionViewState {
  let terminal: SessionViewFacts["terminals"][number] | undefined;
  for (const candidate of terminals)
    if (terminal === undefined || candidate.sequence > terminal.sequence)
      terminal = candidate;
  if (terminal === undefined) return { kind: "idle" };
  // A later model choice acknowledges the failed run while leaving its
  // diagnostic and terminal in history for inspection.
  if (
    activity.lastModelChoiceSequence !== null &&
    activity.lastModelChoiceSequence > terminal.sequence
  )
    return { kind: "waiting_for_you" };
  if (terminal.outcome === "failed" || terminal.outcome === "interrupted") {
    const fallback =
      terminal.outcome === "interrupted"
        ? "Run was interrupted"
        : "Run failed without a diagnostic";
    return {
      kind: "error",
      cause: displayDiagnostic(terminal.diagnostic ?? fallback) ?? fallback,
    };
  }
  return { kind: "waiting_for_you" };
}

/** Decide a Session's view state from its activity, terminals and progress. */
export function sessionViewState(facts: SessionViewFacts): SessionViewState {
  const { activity, progress } = facts;
  const { queue } = activity;
  if (queue.state === "idle") return idleViewState(facts);
  if (activity.cancellationRequested) return { kind: "cancelling" };
  if (queue.state === "queued")
    return {
      kind: "queued",
      queuedCommandId: queue.commandId,
      runningWork: queue.runningWork,
    };
  if (activity.compaction !== null)
    return { kind: "compacting", trigger: activity.compaction.trigger };
  if (activity.retry !== null)
    return {
      kind: "retrying",
      attempt: activity.retry.attempt,
      maxAttempts: activity.retry.maxAttempts,
      cause: collapsed(activity.retry.errorMessage, retryCauseLimit),
      nextRetryAt: activity.retry.scheduledAt + activity.retry.delayMs,
    };
  if (activity.activeTool !== null)
    return { kind: "running_tool", tool: activity.activeTool };
  return {
    kind: progress === null || progress.text === "" ? "thinking" : "responding",
  };
}

export function sameRunningWork(
  left: AgentRunningWork | null,
  right: AgentRunningWork | null,
): boolean {
  if (left === null || right === null) return left === right;
  return left.phase === right.phase;
}

const occupancyLabels = {
  thinking: "thinking",
  streaming: "streaming",
  running_tool: "running a tool",
  waiting_on_you: "waiting on you",
  cancelling: "cancelling",
} as const satisfies Record<AgentRunningWork["phase"], string>;

/** Activity only: queued messages belong in the transcript, never in this label. */
export function sessionStateLabel(
  state: SessionViewState,
  waitingOnYou = false,
):
  | "thinking"
  | "streaming"
  | "running a tool"
  | "idle"
  | "waiting on you"
  | "cancelling"
  | "failed" {
  switch (state.kind) {
    case "queued":
      return state.runningWork === null
        ? "idle"
        : occupancyLabels[state.runningWork.phase];
    case "thinking":
    case "compacting":
    case "retrying":
      return "thinking";
    case "cancelling":
      return "cancelling";
    case "responding":
      return "streaming";
    case "running_tool":
      return "running a tool";
    case "error":
      return "failed";
    case "idle":
    case "waiting_for_you":
      // A completed turn is idle; an actual attention/approval request is
      // what makes the caller show "waiting on you".
      return waitingOnYou ? "waiting on you" : "idle";
  }
}

/** Whether two view states say the same thing, so a readout can stay stable. */
export function sameSessionViewState(
  left: SessionViewState,
  right: SessionViewState,
): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "queued" && right.kind === "queued")
    return (
      left.queuedCommandId === right.queuedCommandId &&
      sameRunningWork(left.runningWork, right.runningWork)
    );
  if (left.kind === "running_tool" && right.kind === "running_tool")
    return left.tool === right.tool;
  if (left.kind === "compacting" && right.kind === "compacting")
    return left.trigger === right.trigger;
  if (left.kind === "retrying" && right.kind === "retrying")
    return (
      left.attempt === right.attempt &&
      left.maxAttempts === right.maxAttempts &&
      left.cause === right.cause &&
      left.nextRetryAt === right.nextRetryAt
    );
  if (left.kind === "error" && right.kind === "error")
    return left.cause === right.cause;
  return true;
}

/** Coarse activity for a view state: what the composer gates on. */
export function sessionActivityStatus(
  view: SessionViewState,
): SessionActivityStatus {
  switch (view.kind) {
    case "cancelling":
    case "queued":
    case "retrying":
      return view.kind;
    case "responding":
      return "streaming";
    case "thinking":
    case "running_tool":
    case "compacting":
      return "thinking";
    case "idle":
    case "waiting_for_you":
    case "error":
      return "idle";
  }
}
