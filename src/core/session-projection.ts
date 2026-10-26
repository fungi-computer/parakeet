import type {
  SessionAttention,
  SessionCompactionMarker,
  SessionCompactionNotice,
  SessionFrame,
  SessionMessage,
  SessionPendingPrompts,
  SessionProgress,
  SessionSnapshot,
  SessionTerminal,
} from "@fungi.computer/shiitake/client";

import { sameRunningWork } from "./session-view-state.js";

const durableMessageIds = new WeakMap<
  readonly SessionMessage[],
  ReadonlySet<string>
>();

/** Derive completed durable message identity once per immutable history revision. */
export function completedMessageIds(
  messages: readonly SessionMessage[],
): ReadonlySet<string> {
  const known = durableMessageIds.get(messages);
  if (known !== undefined) return known;

  const ids = new Set(messages.map(({ id }) => id));
  durableMessageIds.set(messages, ids);
  return ids;
}

function mergeOrderedUnique<
  T extends Readonly<{ id: string; sequence: number }>,
>(current: readonly T[], incoming: readonly T[]): readonly T[] {
  if (incoming.length === 0) return current;

  const known = new Set(current.map(({ id }) => id));
  const added = incoming.filter(({ id }) => !known.has(id));
  if (added.length === 0) return current;
  return [...current, ...added].sort(
    (left, right) => left.sequence - right.sequence,
  );
}

export function mergeMessages(
  current: readonly SessionMessage[],
  incoming: readonly SessionMessage[],
): readonly SessionMessage[] {
  return mergeOrderedUnique(current, incoming);
}

function retainsProgress(
  progress: SessionProgress | null,
  messages: readonly SessionMessage[],
): SessionProgress | null {
  if (progress === null) return null;
  return completedMessageIds(messages).has(progress.messageId)
    ? null
    : progress;
}

/** Preserve the first terminal for each command, in observed order. */
export function mergeTerminals(
  current: readonly SessionTerminal[],
  incoming: readonly SessionTerminal[],
): readonly SessionTerminal[] {
  const merged: SessionTerminal[] = [];
  const positions = new Map<string, number>();
  for (const terminal of [...current, ...incoming]) {
    const position = positions.get(terminal.commandId);
    if (position === undefined) {
      positions.set(terminal.commandId, merged.length);
      merged.push(terminal);
    }
  }
  if (
    merged.length === current.length &&
    merged.every((terminal, index) => terminal === current[index])
  )
    return current;
  return merged;
}

/** Accumulate compaction markers by identity; a frame never removes one. */
export function mergeCompactions(
  current: readonly SessionCompactionMarker[],
  incoming: readonly SessionCompactionMarker[],
): readonly SessionCompactionMarker[] {
  return mergeOrderedUnique(current, incoming);
}

/** Accumulate compaction notices by identity; a frame never removes one. */
export function mergeCompactionNotices(
  current: readonly SessionCompactionNotice[],
  incoming: readonly SessionCompactionNotice[],
): readonly SessionCompactionNotice[] {
  return mergeOrderedUnique(current, incoming);
}

function sameAttention(
  left: readonly SessionAttention[],
  right: readonly SessionAttention[],
): boolean {
  return (
    left.length === right.length &&
    left.every((item, index) => {
      const other = right[index];
      return (
        item.extensionId === other?.extensionId &&
        item.id === other.id &&
        item.kind === other.kind &&
        item.summary === other.summary &&
        item.since === other.since &&
        item.expiresAt === other.expiresAt
      );
    })
  );
}

function samePending(
  left: SessionPendingPrompts,
  right: SessionPendingPrompts,
): boolean {
  return (
    left.total === right.total &&
    left.hasMore === right.hasMore &&
    left.prompts.length === right.prompts.length &&
    left.prompts.every((prompt, index) => {
      const rightPrompt = right.prompts[index];
      if (rightPrompt === undefined) return false;
      return (
        prompt.commandId === rightPrompt.commandId &&
        prompt.delivery === rightPrompt.delivery &&
        prompt.text === rightPrompt.text
      );
    })
  );
}

/** Activity facts are a few scalars; compare them by content. */
function sameActivity(
  left: SessionSnapshot["activity"],
  right: SessionSnapshot["activity"],
): boolean {
  return (
    left === right ||
    (left.queue.state === right.queue.state &&
      (left.queue.state === "idle" ||
        right.queue.state === "idle" ||
        (left.queue.commandId === right.queue.commandId &&
          (left.queue.state !== "queued" ||
            right.queue.state !== "queued" ||
            sameRunningWork(
              left.queue.runningWork,
              right.queue.runningWork,
            )))) &&
      left.cancellationRequested === right.cancellationRequested &&
      left.activeTool === right.activeTool &&
      left.lastModelChoiceSequence === right.lastModelChoiceSequence &&
      (left.retry === right.retry ||
        (left.retry !== null &&
          right.retry !== null &&
          left.retry.attempt === right.retry.attempt &&
          left.retry.maxAttempts === right.retry.maxAttempts &&
          left.retry.delayMs === right.retry.delayMs &&
          left.retry.errorMessage === right.retry.errorMessage &&
          left.retry.scheduledAt === right.retry.scheduledAt)) &&
      (left.compaction === right.compaction ||
        (left.compaction !== null &&
          right.compaction !== null &&
          left.compaction.trigger === right.compaction.trigger)))
  );
}

/** Apply one already-decoded Shiitake frame to its authoritative projection. */
/** Extension slots are small JSON values; compare them by content. */
function sameExtensionSlots(
  next: SessionSnapshot["extensions"],
  current: SessionSnapshot["extensions"],
): boolean {
  return next === current || JSON.stringify(next) === JSON.stringify(current);
}

export function applySessionFrame(
  current: SessionSnapshot,
  frame: SessionFrame,
): SessionSnapshot {
  if (frame.kind === "reset")
    return {
      ...frame.baseline,
      terminals: mergeTerminals([], frame.baseline.terminals),
      compactions: mergeCompactions([], frame.baseline.compactions ?? []),
      compactionNotices: mergeCompactionNotices(
        [],
        frame.baseline.compactionNotices ?? [],
      ),
    };

  if (frame.kind === "activity")
    return sameActivity(current.activity, frame.activity)
      ? current
      : { ...current, activity: frame.activity };

  if (frame.kind === "tool_output") {
    const completed = new Set(
      current.messages.flatMap((message) =>
        message.value.role === "toolResult" ? [message.value.toolCallId] : [],
      ),
    );
    const toolOutput = frame.toolOutput
      .filter((slot) => !completed.has(slot.toolCallId))
      .map((slot) => {
        const previous = current.toolOutput.find(
          (value) => value.toolCallId === slot.toolCallId,
        );
        return previous !== undefined && previous.revision > slot.revision
          ? previous
          : slot;
      });
    return { ...current, activity: frame.activity, toolOutput };
  }

  if (frame.kind === "progress") {
    const completed = completedMessageIds(current.messages).has(
      frame.progress.messageId,
    );
    const currentProgress = current.progress;
    const sameMessage =
      currentProgress !== null &&
      currentProgress.messageId === frame.progress.messageId;
    const older =
      sameMessage && currentProgress.revision > frame.progress.revision;
    if (completed || older) return current;
    const activity = sameActivity(current.activity, frame.activity)
      ? current.activity
      : frame.activity;
    // A progress observation can carry new owner facts even when its text
    // revision did not change, such as the end of a retry backoff.
    if (sameMessage && currentProgress.revision === frame.progress.revision)
      return activity === current.activity ? current : { ...current, activity };

    return {
      ...current,
      progress: frame.progress,
      activity,
    };
  }

  const pending = samePending(current.pending, frame.pending)
    ? current.pending
    : frame.pending;
  const messages = mergeMessages(current.messages, frame.messages);
  const completedTools = new Set(
    messages.flatMap((message) =>
      message.value.role === "toolResult" ? [message.value.toolCallId] : [],
    ),
  );
  const toolOutput = current.toolOutput.filter(
    (slot) =>
      frame.activity.queue.state !== "idle" &&
      !completedTools.has(slot.toolCallId),
  );
  const terminals = mergeTerminals(current.terminals, frame.terminals);
  const currentCompactions = current.compactions ?? [];
  const compactions = mergeCompactions(
    currentCompactions,
    frame.compactions ?? [],
  );
  const currentCompactionNotices = current.compactionNotices ?? [];
  const compactionNotices = mergeCompactionNotices(
    currentCompactionNotices,
    frame.compactionNotices ?? [],
  );
  const progress =
    frame.activity.queue.state === "idle"
      ? null
      : retainsProgress(current.progress, messages);
  // An update without a context figure leaves the last one in place.
  const context =
    frame.context === undefined ||
    (current.context?.tokens === frame.context.tokens &&
      current.context.window === frame.context.window)
      ? current.context
      : frame.context;
  if (
    messages === current.messages &&
    terminals === current.terminals &&
    compactions === currentCompactions &&
    compactionNotices === currentCompactionNotices &&
    progress === current.progress &&
    toolOutput.length === current.toolOutput.length &&
    pending === current.pending &&
    sameExtensionSlots(frame.extensions, current.extensions) &&
    sameAttention(frame.attention, current.attention) &&
    frame.cursor === current.cursor &&
    sameActivity(frame.activity, current.activity) &&
    context === current.context
  )
    return current;

  const next: SessionSnapshot = {
    ...current,
    cursor: frame.cursor,
    messages,
    terminals,
    compactions,
    compactionNotices,
    progress,
    toolOutput,
    activity: sameActivity(current.activity, frame.activity)
      ? current.activity
      : frame.activity,
    pending,
    attention: sameAttention(frame.attention, current.attention)
      ? current.attention
      : frame.attention,
    extensions: sameExtensionSlots(frame.extensions, current.extensions)
      ? current.extensions
      : frame.extensions,
  };
  // Undefined only while neither the snapshot nor the frame reported one.
  return context === undefined ? next : { ...next, context };
}
