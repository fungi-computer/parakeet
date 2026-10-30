import type {
  AssistantMessageItem,
  ProjectedItem,
  TimelineItem,
  ToolGroupItem,
  ToolItem,
} from "../store/types.js";
import { assistantMessageVisible } from "./assistant-visibility.js";
import {
  liveOutputLines,
  toolCallView,
  type ToolCallView,
  type ToolKind,
} from "./tool-view.js";
import type { SessionToolOutput } from "@fungi.computer/shiitake/client";

/** Overlay only running calls; settled rows and their lazy result views stay shared. */
export function overlayToolOutput(
  items: readonly TimelineItem[],
  output: readonly SessionToolOutput[],
): readonly TimelineItem[] {
  if (output.length === 0) return items;
  return items.map((item) => {
    if (item.kind !== "tool_group") return item;
    const tools = item.tools.map((tool) => {
      const slot = output.find((candidate) => candidate.toolCallId === tool.id);
      if (tool.status !== "running" || slot === undefined) return tool;
      return {
        ...tool,
        live: {
          lines: liveOutputLines(slot.tail),
          droppedBytes: slot.droppedBytes,
          revision: slot.revision,
        },
      };
    });
    if (tools.every((tool, index) => tool === item.tools[index])) return item;
    const calls = item.calls.map((call, index) => {
      const tool = tools[index];
      return tool === undefined || tool === item.tools[index]
        ? call
        : toolCallView(tool);
    });
    return {
      ...item,
      tools,
      calls,
      active: calls.find((call) => call.id === item.active?.id),
    };
  });
}

const nouns = {
  code: ["ran", "script", "scripts"],
  command: ["ran", "command", "commands"],
  edit: ["edited", "file", "files"],
  other: ["called", "tool", "tools"],
  read: ["read", "file", "files"],
  search: ["searched", "pattern", "patterns"],
} as const satisfies Record<ToolKind, readonly [string, string, string]>;

/**
 * One-line summary from typed kinds, in first-seen order:
 * `Read 3 files, ran 2 commands, edited 1 file`. Files count distinct paths.
 */
function summarizeToolCalls(calls: readonly ToolCallView[]): string {
  const counts = new Map<ToolKind, { calls: number; paths: Set<string> }>();
  for (const call of calls) {
    const entry = counts.get(call.kind) ?? { calls: 0, paths: new Set() };
    entry.calls += 1;
    for (const path of call.paths) entry.paths.add(path);
    counts.set(call.kind, entry);
  }
  // Map iteration keeps first-seen order.
  const phrases = [...counts].map(([kind, entry]) => {
    const [verb, singular, plural] = nouns[kind];
    const countsFiles = kind === "read" || kind === "edit";
    const count =
      countsFiles && entry.paths.size > 0 ? entry.paths.size : entry.calls;
    return `${verb} ${String(count)} ${count === 1 ? singular : plural}`;
  });
  const text = phrases.join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function groupStatus(calls: readonly ToolCallView[]): ToolGroupItem["status"] {
  if (calls.some((call) => call.status === "running")) return "running";
  if (calls.some((call) => call.status === "error")) return "error";
  if (calls.some((call) => call.status === "unknown")) return "unknown";
  return "completed";
}

function groupDuration(tools: readonly ToolItem[]): number | undefined {
  let start: number | undefined;
  let end: number | undefined;
  for (const tool of tools) {
    if (tool.startedAt !== undefined)
      start = Math.min(start ?? tool.startedAt, tool.startedAt);
    if (tool.result !== undefined)
      end = Math.max(end ?? tool.result.timestamp, tool.result.timestamp);
  }
  return start === undefined || end === undefined
    ? undefined
    : Math.max(0, end - start);
}

/** Build one group from a non-empty run of consecutive calls. */
export function toolGroup(
  tools: readonly [ToolItem, ...ToolItem[]],
): ToolGroupItem {
  const calls = tools.map(toolCallView);
  const status = groupStatus(calls);
  const active = [...calls].reverse().find((call) => call.status === "running");
  return {
    active,
    calls,
    durationMs: status === "running" ? undefined : groupDuration(tools),
    failedCount: calls.filter((call) => call.status === "error").length,
    id: `tools:${tools[0].id}`,
    kind: "tool_group",
    status,
    summary:
      calls.length === 1 && calls[0] !== undefined
        ? `${calls[0].verb} ${calls[0].label}`
        : summarizeToolCalls(calls),
    tools,
  };
}

/**
 * Fold a stretch of tool work into one group. User rows and rendered assistant
 * content end the stretch; invisible assistant rows can span it.
 */
export function groupToolCalls(
  items: readonly ProjectedItem[],
  breakBefore: ReadonlySet<string> = new Set(),
): TimelineItem[] {
  const rows: TimelineItem[] = [];
  let run: ToolItem[] = [];
  let nontextRows: AssistantMessageItem[] = [];
  const flush = () => {
    const [first, ...rest] = run;
    if (first !== undefined) rows.push(toolGroup([first, ...rest]));
    rows.push(...nontextRows);
    run = [];
    nontextRows = [];
  };
  for (const item of items) {
    if (breakBefore.has(item.id)) flush();
    if (item.kind === "tool") {
      run.push(item);
      continue;
    }
    if (
      item.kind === "assistant_message" &&
      !assistantMessageVisible(item) &&
      run.length > 0
    ) {
      nontextRows.push(item);
      continue;
    }
    flush();
    rows.push(item);
  }
  flush();
  return rows;
}

/** View-only open/closed state shared by the browser and terminal renderers. */
export type ToolDisclosureState = Readonly<{
  /**
   * `default` follows each row's default; `expanded` and `collapsed` are the
   * terminal's global details toggle and override defaults.
   */
  mode: "collapsed" | "default" | "expanded";
  /** Explicit reader choices by group or call id; they win over the mode. */
  overrides: ReadonlyMap<string, boolean>;
}>;

/** Defaults only, with no reader choices. */
export const initialToolDisclosure: ToolDisclosureState = Object.freeze({
  mode: "default",
  overrides: new Map<string, boolean>(),
});

/** Active and failed groups show every call; clean history retains a visible tail. */
export function toolGroupDefaultOpen(group: ToolGroupItem): boolean {
  return group.status !== "completed";
}

/** Even a folded group shows recent calls, rather than hiding all tool work. */
export function visibleToolCalls(
  group: ToolGroupItem,
  open: boolean,
): readonly ToolCallView[] {
  return open ? group.calls : group.calls.slice(-3);
}

/** A failed call opens by default so its error is visible. */
export function toolCallDefaultOpen(call: ToolCallView): boolean {
  return call.status === "error";
}

/** Whether a group or call is currently open. */
export function disclosureOpen(
  state: ToolDisclosureState,
  id: string,
  defaultOpen: boolean,
): boolean {
  const override = state.overrides.get(id);
  if (override !== undefined) return override;
  if (state.mode === "default") return defaultOpen;
  return state.mode === "expanded";
}

/** Flip one group or call, recording the reader's explicit choice. */
export function toggleDisclosure(
  state: ToolDisclosureState,
  id: string,
  defaultOpen: boolean,
): ToolDisclosureState {
  const overrides = new Map(state.overrides);
  overrides.set(id, !disclosureOpen(state, id, defaultOpen));
  return { ...state, overrides };
}

/**
 * Expand everything, or collapse everything when the reader has expanded
 * anything. Either way individual choices are cleared.
 */
export function toggleAllDisclosure(
  state: ToolDisclosureState,
): ToolDisclosureState {
  const anyOpen =
    state.mode === "expanded" ||
    [...state.overrides.values()].some((open) => open);
  return {
    mode: anyOpen ? "collapsed" : "expanded",
    overrides: new Map(),
  };
}
