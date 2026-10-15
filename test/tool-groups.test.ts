import type { SessionMessage } from "@fungi.computer/shiitake/client";
import { expect, it } from "vitest";
import {
  idleActivity,
  runningActivity,
} from "@fungi.computer/parakeet-testing";

import { buildDurableTimeline } from "../src/core/build-timeline.js";
import type { ToolArguments } from "../src/core/tool-contract.js";
import {
  disclosureOpen,
  initialToolDisclosure,
  toggleAllDisclosure,
  toggleDisclosure,
  toolCallDefaultOpen,
  toolGroupDefaultOpen,
  visibleToolCalls,
} from "../src/core/tool-groups.js";
import { formatToolDuration } from "../src/core/tool-view.js";
import type { TimelineItem, ToolGroupItem } from "../src/store/types.js";

const usage = {
  input: 1,
  output: 1,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 2,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

type Call = Readonly<{
  id: string;
  name: string;
  arguments: ToolArguments;
}>;

let sequence = 0;
function next() {
  sequence += 1;
  return sequence;
}

function user(text: string): SessionMessage {
  const at = next();
  return {
    id: `user-${String(at)}`,
    commandId: `command-${String(at)}`,
    sequence: at,
    value: { role: "user", content: text, timestamp: at * 1_000 },
  };
}

function assistant(text: string, calls: readonly Call[] = []): SessionMessage {
  const at = next();
  return {
    id: `assistant-${String(at)}`,
    commandId: null,
    sequence: at,
    value: {
      role: "assistant",
      api: "pi",
      provider: "camel",
      model: "auto",
      content: [
        ...(text === "" ? [] : [{ type: "text" as const, text }]),
        ...calls.map((call) => ({
          type: "toolCall" as const,
          id: call.id,
          name: call.name,
          arguments: call.arguments,
        })),
      ],
      stopReason: calls.length > 0 ? "toolUse" : "stop",
      timestamp: at * 1_000,
      usage,
    },
  };
}

function reasoningOnly(thinking: string): SessionMessage {
  const at = next();
  return {
    id: `assistant-${String(at)}`,
    commandId: null,
    sequence: at,
    value: {
      role: "assistant",
      api: "pi",
      provider: "camel",
      model: "auto",
      content: [{ type: "thinking", thinking }],
      stopReason: "stop",
      timestamp: at * 1_000,
      usage,
    },
  };
}

function result(
  call: Call,
  text: string,
  isError = false,
  elapsed = 250,
): SessionMessage {
  const at = next();
  return {
    id: `result-${call.id}`,
    commandId: null,
    sequence: at,
    value: {
      role: "toolResult",
      toolCallId: call.id,
      toolName: call.name,
      content: [{ type: "text", text }],
      isError,
      timestamp: (at - 1) * 1_000 + elapsed,
    },
  };
}

const read = (id: string, path: string): Call => ({
  id,
  name: "read",
  arguments: { path },
});
const bash = (id: string, command: string): Call => ({
  id,
  name: "bash",
  arguments: { command },
});
const patch = (id: string, ...paths: string[]): Call => ({
  id,
  name: "apply_patch",
  arguments: {
    patch: [
      "*** Begin Patch",
      ...paths.flatMap((path) => [
        `*** Update File: ${path}`,
        "@@ function main",
        " const kept = true;",
        "-const old = 1;",
        "+const next = 2;",
      ]),
      "*** End Patch",
    ].join("\n"),
  },
});

/** One assistant turn per call, each followed by its result, like a real loop. */
function loop(
  calls: readonly Call[],
  failing: ReadonlySet<string> = new Set(),
) {
  return calls.flatMap((call) => [
    assistant("", [call]),
    result(call, `${call.id} output`, failing.has(call.id)),
  ]);
}

function groups(items: readonly TimelineItem[]): ToolGroupItem[] {
  return items.filter((item) => item.kind === "tool_group");
}

function onlyGroup(items: readonly TimelineItem[]): ToolGroupItem {
  const [group, ...rest] = groups(items);
  expect(rest).toEqual([]);
  if (group === undefined) throw new Error("expected one tool group");
  return group;
}

it("folds consecutive calls between two assistant messages into one summarized group", () => {
  const calls = [
    read("r1", "a.ts"),
    read("r2", "b.ts"),
    bash("b1", "pnpm test"),
    read("r3", "c.ts"),
    patch("p1", "a.ts"),
    bash("b2", "pnpm lint"),
  ];
  const { items } = buildDurableTimeline([
    user("Fix it"),
    assistant("Looking."),
    ...loop(calls),
    assistant("Done."),
  ]);
  expect(items.map((item) => item.kind)).toEqual([
    "user_message",
    "assistant_message",
    "tool_group",
    "assistant_message",
  ]);
  const group = onlyGroup(items);
  expect(group.id).toBe("tools:r1");
  expect(group.status).toBe("completed");
  expect(group.summary).toBe("Read 3 files, ran 2 commands, edited 1 file");
  expect(visibleToolCalls(group, false).map((call) => call.id)).toEqual([
    "r3",
    "p1",
    "b2",
  ]);
  expect(visibleToolCalls(group, true)).toEqual(group.calls);
  expect(group.calls.map((call) => call.kind)).toEqual([
    "read",
    "read",
    "command",
    "read",
    "edit",
    "command",
  ]);
  expect(group.calls.map((call) => call.label)).toEqual([
    "a.ts",
    "b.ts",
    "pnpm test",
    "c.ts",
    "a.ts",
    "pnpm lint",
  ]);
  expect(group.durationMs).toBeGreaterThan(0);
  expect(toolGroupDefaultOpen(group)).toBe(false);
});

it("starts a new group whenever assistant text interleaves the calls", () => {
  const { items } = buildDurableTimeline([
    ...loop([read("r1", "a.ts"), read("r2", "b.ts")]),
    assistant("Now the tests."),
    ...loop([bash("b1", "pnpm test")]),
    assistant("And the tool call in the same message.", [read("r3", "c.ts")]),
    result(read("r3", "c.ts"), "ok"),
  ]);
  expect(items.map((item) => item.kind)).toEqual([
    "tool_group",
    "assistant_message",
    "tool_group",
    "assistant_message",
    "tool_group",
  ]);
  expect(groups(items).map((group) => group.summary)).toEqual([
    "Read 2 files",
    "Ran pnpm test",
    "Read c.ts",
  ]);
});

it("keeps one tool group across assistant rows with no rendered content", () => {
  const { items } = buildDurableTimeline([
    user("Inspect the files"),
    ...loop([read("r1", "a.ts")]),
    assistant(""),
    reasoningOnly("   "),
    assistant("   "),
    ...loop([read("r2", "b.ts")]),
    user("Now inspect a new task"),
    ...loop([read("r3", "c.ts")]),
  ]);
  expect(
    groups(items).map((group) => group.calls.map((call) => call.id)),
  ).toEqual([["r1", "r2"], ["r3"]]);
  expect(items.filter((item) => item.kind === "assistant_message")).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        text: "",
        thinking: "   ",
      }),
    ]),
  );
});

it("ends a group at displayed reasoning and preserves transcript order", () => {
  const { items } = buildDurableTimeline([
    ...loop([read("r1", "a.ts")]),
    reasoningOnly("The next file may explain it."),
    ...loop([read("r2", "b.ts")]),
  ]);
  expect(items.map((item) => item.kind)).toEqual([
    "tool_group",
    "assistant_message",
    "tool_group",
  ]);
  expect(
    groups(items).map((group) => group.calls.map((call) => call.id)),
  ).toEqual([["r1"], ["r2"]]);
  expect(items[1]).toMatchObject({
    thinking: "The next file may explain it.",
  });
});

it("keeps a stable group id and a live running line while calls append", () => {
  const first = read("r1", "a.ts");
  const running = bash("b1", "pnpm test --watch=false");
  const prompt = { ...user("Run the checks"), commandId: "active-command" };
  const before = onlyGroup(
    buildDurableTimeline([prompt, ...loop([first])]).items,
  );
  const during = onlyGroup(
    buildDurableTimeline(
      [prompt, ...loop([first]), assistant("", [running])],
      [],
      runningActivity({
        queue: { state: "running", commandId: "active-command" },
        activeTool: "bash",
      }),
    ).items,
  );
  expect(during.id).toBe(before.id);
  expect(during.status).toBe("running");
  expect(during.active).toMatchObject({
    activeVerb: "Running",
    label: "pnpm test --watch=false",
    status: "running",
  });
  expect(during.durationMs).toBeUndefined();
  expect(during.calls.map((call) => call.status)).toEqual([
    "completed",
    "running",
  ]);
  expect(toolGroupDefaultOpen(during)).toBe(true);
});

it("marks a group failed, counts failures, and opens the failed call", () => {
  const calls = [
    read("r1", "a.ts"),
    bash("b1", "pnpm test"),
    read("r2", "b.ts"),
  ];
  const group = onlyGroup(
    buildDurableTimeline(loop(calls, new Set(["b1"]))).items,
  );
  expect(group.status).toBe("error");
  expect(group.failedCount).toBe(1);
  expect(toolGroupDefaultOpen(group)).toBe(true);
  expect(group.calls.map(toolCallDefaultOpen)).toEqual([false, true, false]);
});

it("keeps an earlier failed call visible while the next call runs", () => {
  const failed = bash("b1", "pnpm test");
  const next = bash("b2", "pnpm typecheck");
  const prompt = { ...user("Run checks"), commandId: "active-command" };
  const group = onlyGroup(
    buildDurableTimeline(
      [prompt, ...loop([failed], new Set(["b1"])), assistant("", [next])],
      [],
      runningActivity({
        queue: { state: "running", commandId: "active-command" },
        activeTool: "bash",
      }),
    ).items,
  );
  expect(group.status).toBe("running");
  expect(group.failedCount).toBe(1);
  expect(toolGroupDefaultOpen(group)).toBe(true);
  expect(group.calls.map(toolCallDefaultOpen)).toEqual([true, false]);
});

it("opens a typed Files edit refusal even when the execute transport succeeded", () => {
  const call: Call = {
    id: "edit-refusal",
    name: "execute",
    arguments: {
      code: 'return await files.edit({ path: "client.js", oldText: "old", newText: "new" });',
    },
  };
  const refusal = JSON.stringify({
    status: "failed",
    error: {
      kind: "not-found",
      path: "client.js",
      message: "Files edit not-found: read the current file (client.js)",
    },
  });
  const group = onlyGroup(
    buildDurableTimeline([assistant("", [call]), result(call, refusal)]).items,
  );
  expect(group.status).toBe("error");
  expect(group.calls[0]).toMatchObject({
    error: "Files edit not-found: read the current file (client.js)",
    status: "error",
  });
});

it("shows a lone call as a group of one labelled by its target", () => {
  const group = onlyGroup(
    buildDurableTimeline([
      assistant("One read."),
      ...loop([read("r1", "README.md")]),
    ]).items,
  );
  expect(group.calls).toHaveLength(1);
  expect(group.summary).toBe("Read README.md");
});

it("summarizes a very long run in one bounded line", () => {
  const calls = Array.from({ length: 200 }, (_, index) =>
    index % 2 === 0
      ? read(`r${String(index)}`, `src/file-${String(index % 20)}.ts`)
      : {
          id: `x${String(index)}`,
          name: "execute",
          arguments: { code: "return 1;" },
        },
  );
  const group = onlyGroup(buildDurableTimeline(loop(calls)).items);
  expect(group.calls).toHaveLength(200);
  expect(group.summary).toBe("Read 10 files, ran 100 scripts");
});

it("derives kinds from typed names, never from argument text", () => {
  const group = onlyGroup(
    buildDurableTimeline(
      loop([
        patch("p1", "src/a.ts", "src/b.ts"),
        {
          id: "e1",
          name: "edit",
          arguments: { path: "c.ts", oldText: "a", newText: "b" },
        },
        { id: "m1", name: "mcp_unknown", arguments: { query: "Read 9 files" } },
      ]),
    ).items,
  );
  const [edit, replace, other] = group.calls;
  expect(edit).toMatchObject({ kind: "edit", label: "src/a.ts +1" });
  expect(edit?.paths).toEqual(["src/a.ts", "src/b.ts"]);
  expect(replace).toMatchObject({
    kind: "edit",
    verb: "Updated",
    label: "c.ts",
  });
  expect(other).toMatchObject({ kind: "other", label: "mcp_unknown" });
  expect(group.summary).toBe("Edited 3 files, called 1 tool");
});

it("keeps reader choices above defaults and toggles everything at once", () => {
  let state = initialToolDisclosure;
  expect(disclosureOpen(state, "g", false)).toBe(false);
  expect(disclosureOpen(state, "failed", true)).toBe(true);
  state = toggleDisclosure(state, "failed", true);
  expect(disclosureOpen(state, "failed", true)).toBe(false);
  state = toggleAllDisclosure(state);
  expect(state.mode).toBe("expanded");
  expect(disclosureOpen(state, "g", false)).toBe(true);
  expect(disclosureOpen(state, "failed", true)).toBe(true);
  state = toggleDisclosure(state, "g", false);
  expect(disclosureOpen(state, "g", false)).toBe(false);
  state = toggleAllDisclosure(state);
  expect(state.mode).toBe("collapsed");
  // Collapse-all closes failures too; a later click still wins.
  expect(disclosureOpen(state, "failed", true)).toBe(false);
  state = toggleDisclosure(state, "failed", true);
  expect(disclosureOpen(state, "failed", true)).toBe(true);
  expect(toggleAllDisclosure(state).mode).toBe("collapsed");
});

it("formats compact durations", () => {
  expect(formatToolDuration(340)).toBe("340ms");
  expect(formatToolDuration(1_240)).toBe("1.2s");
  expect(formatToolDuration(125_000)).toBe("2m 5s");
});

it("does not label missing historical tool results running, even with stale idle activity", () => {
  const prompt = { ...user("Read the notes"), commandId: "active-command" };
  const history = [prompt, assistant("", [read("orphan", "notes.md")])];
  for (const activity of [
    undefined,
    idleActivity,
    { ...idleActivity, activeTool: "read" },
  ]) {
    const group = onlyGroup(buildDurableTimeline(history, [], activity).items);
    expect(group.status).toBe("unknown");
    expect(group.active).toBeUndefined();
    expect(group.calls[0]?.status).toBe("unknown");
  }
});

it("borrows active-tool status only for the current command, never a previous run", () => {
  const oldCall = assistant("", [read("old-call", "old.md")]);
  const prompt = { ...user("Read new notes"), commandId: "active-command" };
  const activity = runningActivity({
    queue: { state: "running", commandId: "active-command" },
    activeTool: "read",
  });
  const old = onlyGroup(
    buildDurableTimeline([oldCall, prompt], [], activity).items,
  );
  expect(old.status).toBe("unknown");
  const current = groups(
    buildDurableTimeline(
      [oldCall, prompt, assistant("", [read("current-call", "new.md")])],
      [],
      activity,
    ).items,
  );
  expect(current.map((group) => group.status)).toEqual(["unknown", "running"]);
});
