import {
  noAuthor,
  type ParakeetAuthor,
  type ParakeetAuthorOf,
} from "./author-labels.js";
import type {
  SessionActivity,
  SessionCompactionMarker,
  SessionCompactionNotice,
  SessionMessage,
  SessionPendingPrompt,
  SessionProgress,
} from "@fungi.computer/shiitake/client";

import type {
  AssistantMessageItem,
  LocalPromptAdmission,
  ProjectedItem,
  TimelineItem,
  ToolItem,
  UserMessageItem,
} from "../store/types.js";
import { completedMessageIds } from "./session-projection.js";
import { ToolArgumentsSchema } from "./tool-contract.js";
import { assistantMessageVisible } from "./assistant-visibility.js";
import { groupToolCalls } from "./tool-groups.js";

/**
 * One ordering source feeding the durable timeline: an exact message, a
 * compaction divider, or a compaction notice. Markers sort immediately
 * before the message at the same `sequence` (tie 0 beats tie 1 beats tie 2),
 * matching the Woodstock boundary they mark; a notice sits at its own entry's
 * sequence, like a message.
 */
type TimelineSource =
  | Readonly<{
      sequence: number;
      tie: 0;
      kind: "marker";
      marker: SessionCompactionMarker;
    }>
  | Readonly<{
      sequence: number;
      tie: 1;
      kind: "message";
      message: SessionMessage;
    }>
  | Readonly<{
      sequence: number;
      tie: 2;
      kind: "notice";
      notice: SessionCompactionNotice;
    }>;

function orderedSources(
  messages: readonly SessionMessage[],
  compactions: readonly SessionCompactionMarker[],
  notices: readonly SessionCompactionNotice[],
): readonly TimelineSource[] {
  const sources: TimelineSource[] = [
    ...messages.map((message): TimelineSource => ({
      sequence: message.sequence,
      tie: 1,
      kind: "message",
      message,
    })),
    ...compactions.map((marker): TimelineSource => ({
      sequence: marker.sequence,
      tie: 0,
      kind: "marker",
      marker,
    })),
    ...notices.map((notice): TimelineSource => ({
      sequence: notice.sequence,
      tie: 2,
      kind: "notice",
      notice,
    })),
  ];
  return sources.sort(
    (left, right) => left.sequence - right.sequence || left.tie - right.tie,
  );
}

export type TimelineProjection = Readonly<{
  items: readonly TimelineItem[];
  model?: Readonly<{ model: string; provider: string }>;
  usage?: Readonly<{ cost: number; tokens: number }>;
}>;

/**
 * The client request identity of a prompt this composer submitted, by its
 * owner-issued command, so one row keeps its identity from submit to durable.
 */
export type PromptRequestIdOf = (commandId: string) => string | undefined;

const noRequestId: PromptRequestIdOf = () => undefined;

/** Carry a local prompt's request identity onto its owner-reported row. */
function withRequestId(
  item: UserMessageItem,
  requestId: string | undefined,
): UserMessageItem {
  return requestId === undefined ? item : { ...item, requestId };
}

export type DurableTimelineProjection = TimelineProjection &
  Readonly<{
    completedMessageIds: ReadonlySet<string>;
    commandIds: ReadonlySet<string>;
    requestIds: ReadonlySet<string>;
    positionAnchors: ReadonlyMap<number, string | null>;
    commandAnchors: ReadonlyMap<string, string>;
  }>;

function userText(
  content: Extract<SessionMessage["value"], { role: "user" }>["content"],
): string {
  return Array.isArray(content)
    ? content
        .flatMap((part) => (part.type === "text" ? [part.text] : []))
        .join("\n")
    : content;
}

function toolItem(
  call: Extract<
    Extract<SessionMessage["value"], { role: "assistant" }>["content"][number],
    { type: "toolCall" }
  >,
  startedAt: number,
): ToolItem {
  return {
    args: ToolArgumentsSchema.parse(call.arguments),
    id: call.id,
    kind: "tool",
    name: call.name,
    startedAt,
    status: "unknown",
  };
}

function progressItem(progress: SessionProgress): AssistantMessageItem {
  const base: AssistantMessageItem = {
    id: progress.messageId,
    kind: "assistant_message",
    pending: true,
    text: progress.text,
  };
  return progress.thinking === ""
    ? base
    : { ...base, thinking: progress.thinking };
}

type AssistantProjection = Readonly<{
  items: readonly ProjectedItem[];
  model: NonNullable<TimelineProjection["model"]>;
  usage: NonNullable<TimelineProjection["usage"]>;
}>;

type AssistantBlocks = Readonly<{
  text: readonly string[];
  thinking: readonly string[];
  tools: readonly ToolItem[];
}>;

function collectAssistantBlocks(
  value: Extract<SessionMessage["value"], { role: "assistant" }>,
): AssistantBlocks {
  const text: string[] = [];
  const thinking: string[] = [];
  const tools: ToolItem[] = [];
  for (const block of value.content) {
    if (block.type === "text") text.push(block.text);
    if (block.type === "thinking") thinking.push(block.thinking);
    if (block.type === "toolCall") tools.push(toolItem(block, value.timestamp));
  }
  return { text, thinking, tools };
}

function assistantMessageItem(
  id: string,
  value: Extract<SessionMessage["value"], { role: "assistant" }>,
  blocks: AssistantBlocks,
): AssistantMessageItem | undefined {
  if (
    blocks.text.length === 0 &&
    blocks.thinking.length === 0 &&
    blocks.tools.length > 0
  )
    return undefined;

  const item: AssistantMessageItem = {
    id,
    isError: value.stopReason === "error" || value.stopReason === "aborted",
    kind: "assistant_message",
    pending: false,
    at: value.timestamp,
    text:
      blocks.text.length === 0
        ? value.stopReason === "error"
          ? "This run couldn’t finish."
          : value.stopReason === "aborted"
            ? "The run was cancelled."
            : ""
        : blocks.text.join(""),
    usage: {
      cost: value.usage.cost.total,
      tokens: value.usage.totalTokens,
    },
  };
  const withProviderError =
    value.stopReason === "error" && value.providerError !== undefined
      ? {
          ...item,
          text: value.errorMessage ?? "This run couldn’t finish.",
          providerError: value.providerError,
        }
      : item;
  const withDetail =
    value.stopReason === "error" &&
    value.providerError !== undefined &&
    blocks.text.length > 0
      ? {
          ...withProviderError,
          errorDetail: blocks.text.join("").slice(0, 160),
        }
      : withProviderError;
  return blocks.thinking.length === 0
    ? withDetail
    : { ...withDetail, thinking: blocks.thinking.join("\n") };
}

/** Presentation-only folding; durable messages and their raw evidence remain intact. */
function collapseProviderErrors(
  rows: readonly TimelineItem[],
  breakBefore: ReadonlySet<string>,
) {
  const items: TimelineItem[] = [];
  const aliases = new Map<string, string>();
  for (const row of rows) {
    const prior = items.at(-1);
    if (
      !breakBefore.has(row.id) &&
      row.kind === "assistant_message" &&
      row.isError &&
      prior?.kind === "assistant_message" &&
      prior.isError &&
      row.providerError !== undefined &&
      prior.providerError !== undefined &&
      row.text === prior.text &&
      row.errorDetail === prior.errorDetail &&
      row.thinking === prior.thinking &&
      row.author?.id === prior.author?.id &&
      row.author?.name === prior.author?.name
    ) {
      items[items.length - 1] = {
        ...prior,
        repeatCount: (prior.repeatCount ?? 1) + 1,
        // Details show the latest response, including its request id.
        providerError: row.providerError,
      };
      aliases.set(row.id, prior.id);
    } else items.push(row);
  }
  return { items, aliases };
}

function projectAssistant(
  id: string,
  value: Extract<SessionMessage["value"], { role: "assistant" }>,
  author?: ParakeetAuthor,
): AssistantProjection {
  const blocks = collectAssistantBlocks(value);
  const message = assistantMessageItem(id, value, blocks);
  return {
    items:
      message === undefined
        ? blocks.tools
        : [{ ...message, author }, ...blocks.tools],
    model: { model: value.model, provider: value.provider },
    usage: { cost: value.usage.cost.total, tokens: value.usage.totalTokens },
  };
}

function appendAssistant(
  items: ProjectedItem[],
  toolIndexes: Map<string, number>,
  assistant: AssistantProjection,
): void {
  for (const item of assistant.items) {
    if (item.kind === "tool") toolIndexes.set(item.id, items.length);
    items.push(item);
  }
}

function completeTool(
  items: ProjectedItem[],
  toolIndexes: ReadonlyMap<string, number>,
  value: Extract<SessionMessage["value"], { role: "toolResult" }>,
  data: SessionMessage["data"],
): void {
  const toolIndex = toolIndexes.get(value.toolCallId);
  if (toolIndex === undefined) return;
  const tool = items[toolIndex];
  if (tool?.kind !== "tool") return;
  items[toolIndex] = {
    ...tool,
    result: value,
    data,
    status: value.isError ? "error" : "completed",
  };
}

/**
 * Project one durable Session revision into timeline rows, folding consecutive
 * tool calls into groups. `compactions` places one divider row immediately
 * before the message it marks; `notices` places a short row at a compaction
 * that changed nothing. The model's own context is unaffected by this purely
 * client-side projection.
 */
export function buildDurableTimeline(
  messages: readonly SessionMessage[],
  compactions: readonly SessionCompactionMarker[] = [],
  activity?: SessionActivity,
  authorOf: ParakeetAuthorOf = noAuthor,
  requestIdOf: PromptRequestIdOf = noRequestId,
  notices: readonly SessionCompactionNotice[] = [],
  positions: readonly number[] = [],
  shown: (item: TimelineItem) => boolean = () => true,
): DurableTimelineProjection {
  const items: ProjectedItem[] = [];
  const toolIndexes = new Map<string, number>();
  const commandIds = new Set<string>();
  const itemSequences = new Map<string, number>();
  const itemCommands = new Map<string, Set<string>>();
  let model: TimelineProjection["model"];
  let tokens = 0;
  let cost = 0;

  for (const source of orderedSources(messages, compactions, notices)) {
    if (source.kind === "marker") {
      itemSequences.set(source.marker.id, source.sequence);
      items.push({
        id: source.marker.id,
        kind: "compaction_divider",
        at: source.marker.at,
        tokensBefore: source.marker.tokensBefore,
        tokensAfter: source.marker.tokensAfter,
      });
      continue;
    }
    if (source.kind === "notice") {
      itemSequences.set(source.notice.id, source.sequence);
      items.push({
        id: source.notice.id,
        kind: "compaction_notice",
        at: source.notice.at,
        trigger: source.notice.trigger,
        result: source.notice.result,
        diagnostic: source.notice.diagnostic,
      });
      continue;
    }
    const message = source.message;
    const value = message.value;
    if (message.commandId !== null) commandIds.add(message.commandId);
    const firstItem = items.length;
    switch (value.role) {
      case "user": {
        const commandId = message.commandId ?? message.id;
        const confirmed: UserMessageItem = {
          id: message.id,
          kind: "user_message",
          commandId,
          status: "confirmed",
          at: value.timestamp,
          text: userText(value.content),
          author: authorOf(message.meta),
          origin: message.origin,
        };
        items.push(
          withRequestId(confirmed, message.requestId ?? requestIdOf(commandId)),
        );
        break;
      }
      case "assistant": {
        const assistant = projectAssistant(
          message.id,
          value,
          authorOf(message.meta),
        );
        model = assistant.model;
        tokens += assistant.usage.tokens;
        cost += assistant.usage.cost;
        appendAssistant(items, toolIndexes, assistant);
        break;
      }
      case "toolResult":
        completeTool(items, toolIndexes, value, message.data);
        if (message.commandId !== null) {
          const commands =
            itemCommands.get(value.toolCallId) ?? new Set<string>();
          commands.add(message.commandId);
          itemCommands.set(value.toolCallId, commands);
        }
        break;
    }
    for (const item of items.slice(firstItem))
      itemSequences.set(item.id, source.sequence);
    if (message.commandId !== null) {
      for (const item of items.slice(firstItem))
        itemCommands.set(item.id, new Set([message.commandId]));
    }
  }

  // A durable call without a result is not evidence that it still runs.
  // Only the current command's last matching call can borrow live tool activity.
  const queue = activity?.queue;
  if (queue?.state === "running" && activity?.activeTool !== null) {
    let currentCommand = false;
    let toolIndex = -1;
    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      if (item?.kind === "user_message") {
        currentCommand = item.commandId === queue.commandId;
        if (currentCommand) toolIndex = -1;
      }
      if (
        currentCommand &&
        item?.kind === "tool" &&
        item.status === "unknown" &&
        item.name === activity?.activeTool
      )
        toolIndex = index;
    }
    const active = items[toolIndex];
    if (active?.kind === "tool")
      items[toolIndex] = { ...active, status: "running" };
  }
  // Later calls must not grow a tool group across a committed event.
  const breakBefore = new Set<string>();
  let previousSequence = 0;
  for (const item of items) {
    const sequence = itemSequences.get(item.id);
    if (sequence === undefined) continue;
    if (
      positions.some(
        (position) => previousSequence <= position && position < sequence,
      )
    )
      breakBefore.add(item.id);
    previousSequence = sequence;
  }
  const grouped = groupToolCalls(items, breakBefore);
  const commandAnchors = new Map<string, string>();
  for (const row of grouped) {
    if (row.kind === "assistant_message" && !assistantMessageVisible(row))
      continue;
    const members = row.kind === "tool_group" ? row.tools : [row];
    for (const member of members)
      for (const command of itemCommands.get(member.id) ?? [])
        commandAnchors.set(command, row.id);
  }
  const positionAnchors = new Map<number, string | null>();
  for (const position of positions) {
    let anchor: string | null = null;
    for (const row of grouped) {
      if (!shown(row)) continue;
      if (row.kind === "assistant_message" && !assistantMessageVisible(row))
        continue;
      const members = row.kind === "tool_group" ? row.tools : [row];
      if (
        members.some((member) => {
          const sequence = itemSequences.get(member.id);
          return sequence !== undefined && sequence <= position;
        })
      )
        anchor = row.id;
    }
    positionAnchors.set(position, anchor);
  }
  const collapsed = collapseProviderErrors(grouped, breakBefore);
  for (const [command, anchor] of commandAnchors)
    commandAnchors.set(command, collapsed.aliases.get(anchor) ?? anchor);
  for (const [position, anchor] of positionAnchors)
    if (anchor !== null)
      positionAnchors.set(position, collapsed.aliases.get(anchor) ?? anchor);
  const base = {
    commandAnchors,
    positionAnchors,
    completedMessageIds: completedMessageIds(messages),
    items: collapsed.items,
    commandIds,
    requestIds: new Set(
      messages.flatMap((message) =>
        message.requestId === undefined ? [] : [message.requestId],
      ),
    ),
  };
  return model === undefined
    ? base
    : { ...base, model, usage: { cost, tokens } };
}

/** Project replaceable live work without copying settled history. */
export function buildTimelineTail(
  durable: DurableTimelineProjection,
  progress: SessionProgress | null,
  queued: readonly SessionPendingPrompt[],
  admissions: readonly LocalPromptAdmission[] = [],
  authorOf: ParakeetAuthorOf = noAuthor,
): readonly TimelineItem[] {
  const visibleProgress =
    progress === null ||
    durable.completedMessageIds.has(progress.messageId) ||
    (progress.text === "" && progress.thinking === "")
      ? undefined
      : progress;
  if (
    admissions.length === 0 &&
    visibleProgress === undefined &&
    queued.length === 0
  )
    return [];

  const items: UserMessageItem[] = [];
  const queuedCommandIds = new Set(queued.map(({ commandId }) => commandId));
  for (const prompt of queued) {
    if (durable.commandIds.has(prompt.commandId)) continue;
    const waiting: UserMessageItem = {
      id: prompt.commandId,
      kind: "user_message",
      commandId: prompt.commandId,
      status: "queued",
      delivery: prompt.delivery,
      text: prompt.text,
      origin: prompt.origin,
      author: authorOf(prompt.meta),
    };
    items.push(withRequestId(waiting, prompt.requestId));
  }
  for (const admission of admissions) {
    if (
      durable.requestIds.has(admission.requestId) ||
      queued.some((prompt) => prompt.requestId === admission.requestId)
    )
      continue;
    if (
      admission.commandId !== undefined &&
      (queuedCommandIds.has(admission.commandId) ||
        durable.commandIds.has(admission.commandId))
    )
      continue;
    const baseItem = {
      id: admission.requestId,
      kind: "user_message",
      requestId: admission.requestId,
      status:
        admission.status === "failed"
          ? "failed"
          : admission.status === "accepted"
            ? "accepted"
            : admission.status === "queued-local"
              ? "queued"
              : "pending",
      delivery: admission.delivery,
      text: admission.content,
    } satisfies Omit<UserMessageItem, "commandId" | "error">;
    const commandItem =
      admission.commandId === undefined
        ? baseItem
        : { ...baseItem, commandId: admission.commandId };
    const item: UserMessageItem =
      admission.error === undefined
        ? commandItem
        : { ...commandItem, error: admission.error };
    items.push(item);
  }
  // Group only unresolved input; settled history and live progress keep their
  // places. Filtering preserves the owner's order within each delivery group.
  return [
    ...(visibleProgress === undefined ? [] : [progressItem(visibleProgress)]),
    ...items.filter(
      (item) => item.status !== "failed" && item.delivery === "steer",
    ),
    ...items.filter(
      (item) => item.status !== "failed" && item.delivery === "followUp",
    ),
    ...items.filter((item) => item.status === "failed"),
  ];
}

/** Overlay live progress and an optimistic prompt over stable durable rows. */
export function buildTimeline(
  durable: DurableTimelineProjection,
  progress: SessionProgress | null,
  queued: readonly SessionPendingPrompt[],
  admissions: readonly LocalPromptAdmission[] = [],
): TimelineProjection {
  const tail = buildTimelineTail(durable, progress, queued, admissions);
  if (tail.length === 0) return durable;
  const items = [...durable.items, ...tail];
  if (durable.model === undefined || durable.usage === undefined)
    return { items };
  return { items, model: durable.model, usage: durable.usage };
}
