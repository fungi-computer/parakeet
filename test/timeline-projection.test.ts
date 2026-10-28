import type {
  SessionMessage,
  SessionTerminal,
} from "@fungi.computer/shiitake/client";
import { expect, it } from "vitest";

import {
  buildDurableTimeline,
  buildTimelineTail,
  buildTimeline,
} from "../src/core/build-timeline.js";
import {
  applySessionFrame,
  mergeCompactions,
  mergeMessages,
} from "../src/core/session-projection.js";
import { sessionViewState } from "../src/core/session-view-state.js";
import {
  idleFacts,
  queuedFacts,
  runningFacts,
  sessionSnapshot,
  sessionFrame,
} from "./fixtures/session.fixture.js";

const usage = {
  input: 2,
  output: 3,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 5,
  cost: {
    input: 0.01,
    output: 0.02,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0.03,
  },
};

it("replaces live tool sets, ignores older revisions, and removes tails on a durable result", () => {
  const baseline = sessionSnapshot({
    messages: messages.slice(0, 2),
    activity: runningFacts(),
  });
  const slot = {
    toolCallId: "call-1",
    revision: 2,
    tail: "step 2",
    droppedBytes: 0,
    totalBytes: 6,
  };
  const live = applySessionFrame(baseline, {
    kind: "tool_output",
    activity: baseline.activity,
    toolOutput: [slot],
  });
  expect(live.toolOutput).toEqual([slot]);
  expect(live.cursor).toBe(baseline.cursor);
  const stale = applySessionFrame(live, {
    kind: "tool_output",
    activity: baseline.activity,
    toolOutput: [{ ...slot, revision: 1, tail: "old" }],
  });
  expect(stale.toolOutput).toEqual([slot]);
  expect(
    applySessionFrame(live, {
      kind: "tool_output",
      activity: baseline.activity,
      toolOutput: [],
    }).toolOutput,
  ).toEqual([]);
  const settled = applySessionFrame(
    live,
    sessionFrame({
      kind: "update",
      delivery: "live",
      cursor: "result",
      terminals: [],
      pending: baseline.pending,
      messages: messages.slice(2),
      activity: runningFacts(),
    }),
  );
  expect(settled.toolOutput).toEqual([]);
  expect(
    applySessionFrame(settled, {
      kind: "tool_output",
      activity: baseline.activity,
      toolOutput: [slot],
    }).toolOutput,
  ).toEqual([]);
});

const messages: readonly SessionMessage[] = [
  {
    id: "user-1",
    commandId: "command-1",
    sequence: 1,
    value: { role: "user", content: "Inspect it", timestamp: 1 },
  },
  {
    id: "assistant-1",
    commandId: null,
    sequence: 2,
    value: {
      role: "assistant",
      api: "pi",
      provider: "camel",
      model: "auto",
      content: [
        { type: "thinking", thinking: "Checking" },
        { type: "text", text: "I found it." },
        {
          type: "toolCall",
          id: "call-1",
          name: "execute",
          arguments: { code: "return await computer.read('README.md');" },
        },
      ],
      stopReason: "toolUse",
      timestamp: 2,
      usage,
    },
  },
  {
    id: "result-1",
    commandId: null,
    sequence: 3,
    value: {
      role: "toolResult",
      toolCallId: "call-1",
      toolName: "read",
      content: [{ type: "text", text: "done" }],
      isError: false,
      timestamp: 3,
    },
  },
];

/** One compaction marker as the Session projection carries it. */
function compactionMarker(id: string, sequence: number, at: number) {
  return {
    id,
    sequence,
    at,
    tokensBefore: 1_000,
    tokensAfter: 400,
    trigger: "threshold",
  } as const;
}

it("merges ordered projection entries once and preserves no-op references", () => {
  const [firstMessage, secondMessage, thirdMessage] = messages;
  if (!firstMessage || !secondMessage || !thirdMessage)
    throw new Error("Missing message fixture");
  const currentMessages = [firstMessage];
  const mergedMessages = mergeMessages(currentMessages, [
    thirdMessage,
    firstMessage,
    secondMessage,
  ]);
  expect(mergedMessages.map(({ id }) => id)).toEqual([
    "user-1",
    "assistant-1",
    "result-1",
  ]);
  expect(mergeMessages(currentMessages, [firstMessage])).toBe(currentMessages);
  expect(mergeMessages(currentMessages, [])).toBe(currentMessages);

  const currentCompactions = [compactionMarker("compact-1", 1, 1_000)];
  const firstCompaction = currentCompactions[0];
  if (!firstCompaction) throw new Error("Missing compaction fixture");
  const mergedCompactions = mergeCompactions(currentCompactions, [
    compactionMarker("compact-3", 3, 3_000),
    firstCompaction,
    compactionMarker("compact-2", 2, 2_000),
  ]);
  expect(mergedCompactions.map(({ id }) => id)).toEqual([
    "compact-1",
    "compact-2",
    "compact-3",
  ]);
  expect(mergeCompactions(currentCompactions, [firstCompaction])).toBe(
    currentCompactions,
  );
  expect(mergeCompactions(currentCompactions, [])).toBe(currentCompactions);
});

it("projects exact Pi messages, tool results, and optimistic identity", () => {
  const projection = buildTimeline(
    buildDurableTimeline(messages),
    null,
    [],
    [
      {
        content: "Inspect it",
        requestId: "request-1",
        delivery: "steer",
        status: "admitting",
      },
    ],
  );

  expect(projection.items.map(({ id }) => id)).toEqual([
    "user-1",
    "assistant-1",
    "tools:call-1",
    "request-1",
  ]);
  expect(projection.items[2]).toMatchObject({
    kind: "tool_group",
    status: "completed",
    tools: [
      {
        args: { code: "return await computer.read('README.md');" },
        kind: "tool",
        result: {
          role: "toolResult",
          content: [{ type: "text", text: "done" }],
        },
        startedAt: 2,
        status: "completed",
      },
    ],
  });
  expect(projection.model).toEqual({ model: "auto", provider: "camel" });
  expect(projection.usage).toEqual({ cost: 0.03, tokens: 5 });
});

it("keeps owner queue order ahead of later local admissions within one delivery group", () => {
  const tail = buildTimelineTail(
    buildDurableTimeline([]),
    null,
    [
      {
        requestId: "request-" + "earlier-owner-command",
        commandId: "earlier-owner-command",
        delivery: "followUp",
        text: "Earlier accepted prompt",
      },
    ],
    [
      {
        requestId: "later-local-request",
        content: "Later local prompt",
        delivery: "followUp",
        status: "admitting",
      },
    ],
  );

  expect(tail.map(({ id }) => id)).toEqual([
    "earlier-owner-command",
    "later-local-request",
  ]);
});

it("keeps progress replaceable and exact messages structurally stable", () => {
  const baseline = {
    pending: { total: 0, prompts: [], hasMore: false },
    sessionId: "session-1",
    cursor: "cursor-1",
    hasMore: false,
    messages: messages.slice(0, 1),
    terminals: [],
    toolOutput: [],
    progress: null,
    activity: queuedFacts("queued-command"),
    extensions: {},
    attention: [],
  };
  const withProgress = applySessionFrame(baseline, {
    kind: "progress",
    activity: runningFacts(),
    progress: {
      messageId: "assistant-1",
      revision: 1,
      text: "I found",
      thinking: "Checking",
      textTruncated: false,
      thinkingTruncated: false,
    },
  });
  expect(withProgress.messages).toBe(baseline.messages);
  expect(withProgress.activity.queue.state).toBe("running");
  expect(sessionViewState(withProgress)).toEqual({ kind: "responding" });
  // The owner publishes facts; Parakeet decides what the readout says.
  expect(
    sessionViewState(
      applySessionFrame(withProgress, {
        kind: "progress",
        activity: runningFacts({
          retry: {
            attempt: 1,
            maxAttempts: 4,
            delayMs: 1_000,
            errorMessage: "503 Service Unavailable",
            scheduledAt: 3_000,
          },
        }),
        progress: {
          messageId: "assistant-1",
          revision: 2,
          text: "I found more",
          thinking: "Checking",
          textTruncated: false,
          thinkingTruncated: false,
        },
      }),
    ),
  ).toMatchObject({ kind: "retrying", nextRetryAt: 4_000 });

  const completed = applySessionFrame(withProgress, {
    pending: { total: 0, prompts: [], hasMore: false },
    kind: "update",
    delivery: "live",
    cursor: "cursor-3",
    messages: messages.slice(1),
    terminals: [],
    activity: idleFacts,
    extensions: {},
    attention: [],
  });
  expect(completed.messages).toHaveLength(3);
  expect(completed.progress).toBeNull();
  expect(
    buildTimeline(
      buildDurableTimeline(completed.messages),
      completed.progress,
      [],
    ).items,
  ).toHaveLength(3);
});

it("updates a retry readout when only the owner attempt changes", () => {
  const baseline = {
    pending: { total: 0, prompts: [], hasMore: false },
    sessionId: "retry-session",
    cursor: "cursor-1",
    hasMore: false,
    messages: [],
    terminals: [],
    toolOutput: [],
    progress: null,
    activity: runningFacts({
      retry: {
        attempt: 1,
        maxAttempts: 4,
        delayMs: 1_000,
        errorMessage: "503 Service Unavailable",
        scheduledAt: 3_000,
      },
    }),
    extensions: {},
    attention: [],
  };
  const updated = applySessionFrame(baseline, {
    kind: "update",
    delivery: "live",
    cursor: "cursor-1",
    messages: [],
    terminals: [],
    pending: baseline.pending,
    extensions: {},
    attention: [],
    activity: runningFacts({
      retry: {
        attempt: 2,
        maxAttempts: 4,
        delayMs: 2_000,
        errorMessage: "429 rate limit",
        scheduledAt: 8_000,
      },
    }),
  });
  expect(updated).not.toBe(baseline);
  expect(sessionViewState(updated)).toMatchObject({
    attempt: 2,
    cause: "429 rate limit",
    nextRetryAt: 10_000,
  });
});

it("carries a live compaction fact into the projection and clears it again", () => {
  const baseline = {
    pending: { total: 0, prompts: [], hasMore: false },
    sessionId: "compaction-activity-session",
    cursor: "cursor-1",
    hasMore: false,
    messages: [],
    terminals: [],
    toolOutput: [],
    progress: null,
    activity: runningFacts(),
    extensions: {},
    attention: [],
  };
  const compacting = applySessionFrame(baseline, {
    kind: "update",
    delivery: "live",
    cursor: "cursor-1",
    messages: [],
    terminals: [],
    pending: baseline.pending,
    extensions: {},
    attention: [],
    activity: runningFacts({ compaction: { trigger: "manual" } }),
  });
  // The fact changed even though every other activity field stayed put; a
  // same-reference projection here would hide the live state from clients.
  expect(compacting).not.toBe(baseline);
  expect(sessionViewState(compacting)).toEqual({
    kind: "compacting",
    trigger: "manual",
  });

  const cleared = applySessionFrame(compacting, {
    kind: "update",
    delivery: "live",
    cursor: "cursor-1",
    messages: [],
    terminals: [],
    pending: baseline.pending,
    extensions: {},
    attention: [],
    activity: runningFacts(),
  });
  expect(cleared).not.toBe(compacting);
  expect(sessionViewState(cleared)).toEqual({ kind: "thinking" });

  // Re-applying the same facts is a true no-op: the reference is preserved.
  expect(
    applySessionFrame(cleared, {
      kind: "update",
      delivery: "live",
      cursor: "cursor-1",
      messages: [],
      terminals: [],
      pending: baseline.pending,
      extensions: {},
      attention: [],
      activity: runningFacts(),
    }),
  ).toBe(cleared);
});

it("clears retrying when a progress observation keeps the same text revision", () => {
  const progress = {
    messageId: "assistant-retry",
    revision: 1,
    text: "Working",
    thinking: "",
    textTruncated: false,
    thinkingTruncated: false,
  };
  const retrying = sessionSnapshot({
    progress,
    activity: runningFacts({
      retry: {
        attempt: 1,
        maxAttempts: 4,
        delayMs: 1_000,
        errorMessage: "503 Service Unavailable",
        scheduledAt: 3_000,
      },
    }),
  });
  expect(sessionViewState(retrying).kind).toBe("retrying");

  const resumed = applySessionFrame(retrying, {
    kind: "progress",
    progress,
    activity: runningFacts(),
  });
  expect(resumed.progress).toBe(retrying.progress);
  expect(sessionViewState(resumed)).toEqual({ kind: "responding" });
  expect(
    applySessionFrame(resumed, {
      kind: "progress",
      progress: { ...progress, revision: 0 },
      activity: retrying.activity,
    }),
  ).toBe(resumed);
});

const terminal = (
  commandId: string,
  outcome: SessionTerminal["outcome"],
  sequence: number,
): SessionTerminal => ({ commandId, outcome, sequence, diagnostic: null });

it("keeps one durable terminal per command through replay, duplicates, and reset", () => {
  const baseline = sessionSnapshot({
    terminals: [terminal("command-1", "failed", 1)],
  });
  const failed = applySessionFrame(baseline, {
    pending: { total: 0, prompts: [], hasMore: false },
    kind: "update",
    delivery: "replay",
    cursor: "cursor-1",
    messages: [],
    terminals: [
      terminal("command-1", "failed", 1),
      terminal("command-2", "cancelled", 2),
    ],
    activity: idleFacts,
    extensions: {},
    attention: [],
  });
  const duplicate = applySessionFrame(failed, {
    pending: { total: 0, prompts: [], hasMore: false },
    kind: "update",
    delivery: "live",
    cursor: "cursor-1",
    messages: [],
    terminals: failed.terminals,
    activity: idleFacts,
    extensions: {},
    attention: [],
  });

  const conflictingDuplicate = applySessionFrame(failed, {
    pending: { total: 0, prompts: [], hasMore: false },
    kind: "update",
    delivery: "replay",
    cursor: "cursor-1",
    messages: [],
    terminals: [terminal("command-1", "completed", 1)],
    activity: idleFacts,
    extensions: {},
    attention: [],
  });

  expect(conflictingDuplicate.terminals[0]?.outcome).toBe("failed");
  expect(duplicate).toBe(failed);
  expect(duplicate.terminals).toEqual([
    terminal("command-1", "failed", 1),
    terminal("command-2", "cancelled", 2),
  ]);
  expect(
    applySessionFrame(duplicate, {
      kind: "reset",
      reason: "history_unavailable",
      cursor: "cursor-2",
      baseline: sessionSnapshot({
        terminals: [terminal("command-3", "completed", 3)],
      }),
    }).terminals,
  ).toEqual([terminal("command-3", "completed", 3)]);
});

it("replaces same-cursor admission views and renders waiting prompts after live work", () => {
  const baseline = sessionSnapshot();
  const pending = {
    total: 2,
    prompts: [
      {
        requestId: "request-" + "command-one",
        commandId: "command-one",
        delivery: "followUp",
        text: "First accepted task",
      },
      {
        requestId: "request-" + "command-two",
        commandId: "command-two",
        delivery: "followUp",
        text: "Second accepted task",
      },
    ],
    hasMore: false,
  } as const;
  const frame = {
    kind: "update",
    delivery: "live",
    cursor: null,
    messages: [],
    terminals: [],
    activity: runningFacts(),
    extensions: {},
    attention: [],
    pending,
  } as const;
  const updated = applySessionFrame(baseline, frame);
  expect(updated.cursor).toBeNull();
  expect(updated.pending).toEqual(pending);
  const progress = {
    messageId: "active-reply",
    revision: 1,
    text: "Still working",
    thinking: "",
    textTruncated: false,
    thinkingTruncated: false,
  };
  const items = buildTimeline(
    buildDurableTimeline([]),
    progress,
    updated.pending.prompts,
  ).items;
  expect(items.map(({ id }) => id)).toEqual([
    "active-reply",
    "command-one",
    "command-two",
  ]);
  expect(items.slice(1)).toMatchObject([
    { status: "queued" },
    { status: "queued" },
  ]);
  const settled = applySessionFrame(updated, {
    ...frame,
    pending: { total: 0, prompts: [], hasMore: false },
  });
  expect(settled.pending.prompts).toEqual([]);
  expect(
    buildTimeline(buildDurableTimeline([]), progress, settled.pending.prompts)
      .items,
  ).toHaveLength(1);
});

it("orders pending interrupts before cues without changing order within either group", () => {
  const tail = buildTimelineTail(
    buildDurableTimeline([]),
    null,
    [
      {
        requestId: "request-" + "cue-one",
        commandId: "cue-one",
        delivery: "followUp",
        text: "Cue one",
      },
      {
        requestId: "request-" + "interrupt-one",
        commandId: "interrupt-one",
        delivery: "steer",
        text: "Interrupt one",
      },
      {
        requestId: "request-" + "cue-two",
        commandId: "cue-two",
        delivery: "followUp",
        text: "Cue two",
      },
      {
        requestId: "request-" + "interrupt-two",
        commandId: "interrupt-two",
        delivery: "steer",
        text: "Interrupt two",
      },
    ],
    [
      {
        requestId: "cue-local",
        content: "Cue local",
        delivery: "followUp",
        status: "admitting",
      },
      {
        requestId: "interrupt-local",
        content: "Interrupt local",
        delivery: "steer",
        status: "accepted",
      },
    ],
  );
  expect(tail.map(({ id }) => id)).toEqual([
    "interrupt-one",
    "interrupt-two",
    "interrupt-local",
    "cue-one",
    "cue-two",
    "cue-local",
  ]);
});

it("shows the safe provider headline, keeping raw provider text separate", () => {
  const assistant = messages.find(
    (message) => message.value.role === "assistant",
  );
  if (assistant?.value.role !== "assistant")
    throw new Error("Missing assistant fixture");
  const snapshot = sessionSnapshot({
    messages: [
      {
        ...assistant,
        value: {
          ...assistant.value,
          content: [],
          stopReason: "error",
          errorMessage: "Safe model failure",
          providerError: "provider diagnostic fixture",
        },
      },
    ],
  });
  const timeline = buildTimeline(
    buildDurableTimeline(snapshot.messages),
    null,
    [],
  );
  expect(timeline.items[0]).toMatchObject({
    kind: "assistant_message",
    isError: true,
    text: "Safe model failure",
    providerError: "provider diagnostic fixture",
  });
});

it("folds consecutive matching provider errors without losing command or committed-position anchors", () => {
  const assistant = messages.find(
    (message) => message.value.role === "assistant",
  );
  if (assistant?.value.role !== "assistant")
    throw new Error("Missing assistant fixture");
  const value = {
    ...assistant.value,
    content: [],
    stopReason: "error" as const,
    errorMessage: "Anthropic is overloaded.",
  };
  const failures = Array.from({ length: 7 }, (_, index): SessionMessage => ({
    ...assistant,
    id: `error-${String(index)}`,
    commandId: `work-${String(index)}`,
    sequence: index + 1,
    value: { ...value, providerError: `request_id: req_${String(index)}` },
  }));
  const projection = buildDurableTimeline(
    failures,
    [],
    undefined,
    undefined,
    undefined,
    [],
    [7],
  );
  expect(projection.items).toHaveLength(1);
  expect(projection.items[0]).toMatchObject({
    id: "error-0",
    text: "Anthropic is overloaded.",
    repeatCount: 7,
    providerError: "request_id: req_6",
  });
  expect([...projection.commandAnchors.values()]).toEqual(
    Array(7).fill("error-0"),
  );
  expect(projection.positionAnchors.get(7)).toBe("error-0");
  expect(
    buildDurableTimeline(failures, [], undefined, undefined, undefined, [], [3])
      .items,
  ).toHaveLength(2);
});

it("shows safe refusal content and its Billing link in saved history", () => {
  const assistant = messages.find(
    (message) => message.value.role === "assistant",
  );
  if (assistant?.value.role !== "assistant")
    throw new Error("Missing assistant fixture");
  const notice =
    "Your Team is out of credit. Add credit in [Billing](https://hub.example.com/teams/team_zero/billing).";
  const projection = buildDurableTimeline([
    {
      ...assistant,
      value: {
        ...assistant.value,
        content: [{ type: "text", text: notice }],
        stopReason: "error",
        errorMessage: "insufficient_balance",
      },
    },
  ]);
  expect(projection.items[0]).toMatchObject({
    kind: "assistant_message",
    isError: true,
    text: notice,
  });
});

it("places one compaction divider immediately before the message it precedes", () => {
  const compactions = [compactionMarker("compaction-1", 2, 1_700)];
  const projection = buildDurableTimeline(messages, compactions);

  expect(projection.items.map(({ kind }) => kind)).toEqual([
    "user_message",
    "compaction_divider",
    "assistant_message",
    "tool_group",
  ]);
  expect(projection.items[1]).toEqual({
    id: "compaction-1",
    kind: "compaction_divider",
    at: 1_700,
    tokensBefore: 1_000,
    tokensAfter: 400,
  });
});

it("projects a compaction as a divider only, never as a summary message", () => {
  const projection = buildDurableTimeline(messages, [
    compactionMarker("compaction-1", 2, 1_700),
  ]);
  const dividers = projection.items.filter(
    ({ kind }) => kind === "compaction_divider",
  );
  expect(dividers).toHaveLength(1);
  expect(Object.keys(dividers[0] ?? {}).sort()).toEqual([
    "at",
    "id",
    "kind",
    "tokensAfter",
    "tokensBefore",
  ]);
  expect(JSON.stringify(projection.items)).not.toContain("<summary>");
});

it("carries a compaction notice at its own entry's place, like a message", () => {
  const firstTurn: SessionMessage = {
    id: "notice-turn-1",
    commandId: null,
    sequence: 1,
    value: { role: "user", content: "one", timestamp: 1 },
  };
  const secondTurn: SessionMessage = {
    id: "notice-turn-2",
    commandId: null,
    sequence: 3,
    value: { role: "user", content: "two", timestamp: 3 },
  };
  const projection = buildDurableTimeline(
    [firstTurn, secondTurn],
    [],
    undefined,
    undefined,
    undefined,
    [
      {
        id: "notice-1",
        sequence: 2,
        at: 1_700,
        trigger: "threshold",
        result: "nothing_to_compact",
        diagnostic: null,
      },
    ],
  );
  expect(projection.items.map(({ kind, id }) => `${kind}:${id}`)).toEqual([
    "user_message:notice-turn-1",
    "compaction_notice:notice-1",
    "user_message:notice-turn-2",
  ]);
  expect(projection.items[1]).toEqual({
    id: "notice-1",
    kind: "compaction_notice",
    at: 1_700,
    trigger: "threshold",
    result: "nothing_to_compact",
    diagnostic: null,
  });
});

it("places two compaction dividers at their own boundaries, each once", () => {
  // Four clean, non-tool turns so each marker lands at an unambiguous
  // message boundary rather than inside one assistant/tool round trip.
  const fourTurns: readonly SessionMessage[] = [
    {
      id: "turn-1",
      commandId: null,
      sequence: 1,
      value: { role: "user", content: "one", timestamp: 1 },
    },
    {
      id: "turn-2",
      commandId: null,
      sequence: 2,
      value: { role: "user", content: "two", timestamp: 2 },
    },
    {
      id: "turn-3",
      commandId: null,
      sequence: 3,
      value: { role: "user", content: "three", timestamp: 3 },
    },
    {
      id: "turn-4",
      commandId: null,
      sequence: 4,
      value: { role: "user", content: "four", timestamp: 4 },
    },
  ];
  const twoCompactions = [
    compactionMarker("compaction-1", 2, 1_700),
    compactionMarker("compaction-2", 4, 1_800),
  ];
  const projection = buildDurableTimeline(fourTurns, twoCompactions);

  expect(projection.items.map(({ kind, id }) => `${kind}:${id}`)).toEqual([
    "user_message:turn-1",
    "compaction_divider:compaction-1",
    "user_message:turn-2",
    "user_message:turn-3",
    "compaction_divider:compaction-2",
    "user_message:turn-4",
  ]);
});

it("merges compaction markers across frames by identity, never duplicating one", () => {
  const [userTurn, assistantTurn, toolResultTurn] = messages;
  if (
    userTurn === undefined ||
    assistantTurn === undefined ||
    toolResultTurn === undefined
  )
    throw new Error("Missing message fixture");
  const baseline = sessionSnapshot({
    messages: [userTurn],
    compactions: [compactionMarker("compaction-1", 1, 1_000)],
  });
  const replayed = applySessionFrame(baseline, {
    kind: "update",
    delivery: "live",
    cursor: "cursor-2",
    pending: { total: 0, prompts: [], hasMore: false },
    messages: [assistantTurn, toolResultTurn],
    terminals: [],
    compactions: [compactionMarker("compaction-1", 1, 1_000)],
    activity: idleFacts,
    extensions: {},
    attention: [],
  });

  expect(replayed.compactions).toEqual([
    compactionMarker("compaction-1", 1, 1_000),
  ]);
  expect(
    buildDurableTimeline(
      replayed.messages,
      replayed.compactions ?? [],
    ).items.map(({ kind }) => kind),
  ).toEqual([
    "compaction_divider",
    "user_message",
    "assistant_message",
    "tool_group",
  ]);
});

it("replaces attention on an otherwise unchanged frame and preserves equal projections", () => {
  const snapshot = sessionSnapshot();
  const frame = sessionFrame({
    kind: "update",
    delivery: "live",
    cursor: snapshot.cursor,
    messages: [],
    terminals: [],
    pending: snapshot.pending,
    activity: snapshot.activity,
    extensions: snapshot.extensions,
    attention: [
      {
        extensionId: "attention-probe",
        id: "choice",
        kind: "question",
        summary: "Choose",
        since: 1,
      },
    ],
  });
  const changed = applySessionFrame(snapshot, frame);
  expect(changed.attention).toHaveLength(1);
  expect(applySessionFrame(changed, frame)).toBe(changed);
  expect(
    applySessionFrame(
      changed,
      sessionFrame({
        kind: "update",
        delivery: "live",
        cursor: snapshot.cursor,
        messages: [],
        terminals: [],
        pending: snapshot.pending,
        activity: snapshot.activity,
        extensions: snapshot.extensions,
        attention: [],
      }),
    ).attention,
  ).toEqual([]);
});

it("projects the author the host metadata names without changing the user message or its rail", () => {
  const first = messages[0];
  if (first === undefined) throw new Error("Missing user fixture");
  const author = { id: "team-key:key-a", name: "Zed local project" };
  const line = { ...first, meta: { author } };
  // Parakeet never reads metadata itself: without the host's reading, no author.
  expect(buildDurableTimeline([line]).items[0]).toMatchObject({
    author: undefined,
  });
  const seen: unknown[] = [];
  const timeline = buildDurableTimeline([line], [], undefined, (meta) => {
    seen.push(meta);
    return author;
  });
  expect(seen).toEqual([{ author }]);
  expect(timeline.items[0]).toMatchObject({ kind: "user_message", author });
});

it("anchors committed client cells to their fixed Session position despite later output from the same command", () => {
  const commanded = messages.map((message): SessionMessage => ({
    ...message,
    commandId: "command-1",
  }));
  const grouped = buildDurableTimeline(
    commanded,
    [],
    undefined,
    undefined,
    undefined,
    [],
    [0, 3],
  );
  expect(grouped.positionAnchors.get(0)).toBeNull();
  expect(grouped.positionAnchors.get(3)).toBe("tools:call-1");
  const final: SessionMessage = {
    id: "final-answer",
    commandId: "command-1",
    sequence: 4,
    value: {
      role: "assistant",
      api: "pi",
      provider: "camel",
      model: "auto",
      content: [{ type: "text", text: "Inspection complete." }],
      stopReason: "stop",
      timestamp: 4,
      usage,
    },
  };
  expect(
    buildDurableTimeline(
      [...commanded, final],
      [],
      undefined,
      undefined,
      undefined,
      [],
      [3],
    ).positionAnchors.get(3),
  ).toBe("tools:call-1");
});

it("splits tool groups at a committed Session position instead of moving an event below later calls", () => {
  const call = (id: string, sequence: number): SessionMessage => ({
    id: `assistant-${id}`,
    commandId: "same-running-work",
    sequence,
    value: {
      role: "assistant",
      api: "pi",
      provider: "camel",
      model: "auto",
      content: [
        { type: "toolCall", id, name: "execute", arguments: { code: "1" } },
      ],
      stopReason: "toolUse",
      timestamp: sequence,
      usage,
    },
  });
  const rows = [call("before-clear", 2), call("after-clear", 4)];
  expect(buildDurableTimeline(rows).items).toHaveLength(1);
  const placed = buildDurableTimeline(
    rows,
    [],
    undefined,
    undefined,
    undefined,
    [],
    [3],
  );
  expect(placed.items.map(({ id }) => id)).toEqual([
    "tools:before-clear",
    "tools:after-clear",
  ]);
  expect(placed.positionAnchors.get(3)).toBe("tools:before-clear");
});

it("resolves a position after a footer-only prompt against the same row visibility policy", () => {
  const placed = buildDurableTimeline(
    messages.slice(0, 1),
    [],
    undefined,
    undefined,
    undefined,
    [],
    [1],
    () => false,
  );
  expect(placed.positionAnchors.get(1)).toBeNull();
});

it("updates the exact pending total when the bounded preview page is unchanged", () => {
  const snapshot = sessionSnapshot({
    pending: { total: 201, prompts: [], hasMore: true },
  });
  const frame = sessionFrame({
    kind: "update",
    delivery: "live",
    messages: [],
    terminals: [],
    pending: { ...snapshot.pending, total: 202 },
    activity: snapshot.activity,
    attention: snapshot.attention,
    extensions: snapshot.extensions,
    cursor: snapshot.cursor,
  });
  const updated = applySessionFrame(snapshot, frame);
  expect(updated.pending.total).toBe(202);
  expect(updated.pending.prompts).toEqual(snapshot.pending.prompts);
  expect(applySessionFrame(updated, frame)).toBe(updated);
});

it("updates a queued blocker even when the command and cursor stay unchanged", () => {
  const snapshot = sessionSnapshot({
    activity: {
      ...idleFacts,
      queue: {
        state: "queued",
        commandId: "queued-command",
        runningWork: null,
      },
    },
  });
  const frame = sessionFrame({
    kind: "update",
    delivery: "live",
    messages: [],
    terminals: [],
    pending: snapshot.pending,
    cursor: snapshot.cursor,
    attention: snapshot.attention,
    extensions: snapshot.extensions,
    activity: {
      ...snapshot.activity,
      queue: {
        state: "queued",
        commandId: "queued-command",
        runningWork: {
          kind: "session",
          sessionId: "running-session",
          commandId: "running-command",
        },
      },
    },
  });
  if (frame.kind !== "update") throw new Error("Expected an update frame");
  const updated = applySessionFrame(snapshot, frame);
  expect(updated.activity.queue).toEqual(frame.activity.queue);
  expect(updated).not.toBe(snapshot);
  expect(applySessionFrame(updated, frame)).toBe(updated);
});

it("uses the host author for a waiting visitor message", () => {
  const author = { id: "visitor-one", name: "Visitor one" };
  const durable = buildDurableTimeline([]);
  const seen: unknown[] = [];
  const items = buildTimelineTail(
    durable,
    null,
    [
      {
        requestId: "request-" + "waiting",
        commandId: "waiting",
        text: "Hello",
        delivery: "followUp",
        meta: { author },
      },
    ],
    [],
    (meta) => {
      seen.push(meta);
      return author;
    },
  );
  expect(seen).toEqual([{ author }]);
  expect(items[0]).toMatchObject({
    kind: "user_message",
    text: "Hello",
    author,
  });
});

it("retains display data and images when a durable result replaces a live tail", () => {
  const result = messages.find(({ value }) => value.role === "toolResult");
  if (result?.value.role !== "toolResult")
    throw new Error("Missing tool result fixture");
  const data = {
    error: { kind: "permission_denied", message: "Write access was revoked." },
    images: [{ bytes: 3, mimeType: "image/png", path: "diagram.png" }],
  };
  const content: typeof result.value.content = [
    { type: "text", text: "The capability was refused." },
    { type: "image", data: "YWJj", mimeType: "image/png" },
  ];
  const finalMessage: SessionMessage = {
    ...result,
    data,
    meta: { error: "host attribution" },
    value: { ...result.value, content, isError: true },
  };
  const baseline = sessionSnapshot({
    messages: messages.filter(({ value }) => value.role !== "toolResult"),
    activity: runningFacts(),
  });
  const live = applySessionFrame(baseline, {
    kind: "tool_output",
    activity: baseline.activity,
    toolOutput: [
      {
        toolCallId: result.value.toolCallId,
        revision: 1,
        tail: "unfinished tail",
        droppedBytes: 0,
        totalBytes: 15,
      },
    ],
  });
  const final = applySessionFrame(
    live,
    sessionFrame({
      kind: "update",
      delivery: "live",
      cursor: "final-data",
      messages: [finalMessage],
      terminals: [],
      pending: baseline.pending,
      activity: baseline.activity,
    }),
  );
  expect(final.toolOutput).toEqual([]);
  const projected = buildDurableTimeline(final.messages);
  const group = projected.items.find((item) => item.kind === "tool_group");
  if (group?.kind !== "tool_group") throw new Error("Missing tool group");
  expect(group.tools[0]).toMatchObject({
    data,
    status: "error",
    result: { content, isError: true },
  });
  expect(group.tools[0]?.result).not.toHaveProperty("details");
  expect(group.tools[0]?.result).not.toHaveProperty("data");
  expect(group.tools[0]?.data).not.toHaveProperty("meta");
  const replay = applySessionFrame(
    final,
    sessionFrame({
      kind: "update",
      delivery: "replay",
      cursor: "final-data",
      messages: [finalMessage],
      terminals: [],
      pending: baseline.pending,
      activity: baseline.activity,
    }),
  );
  expect(buildDurableTimeline(replay.messages).items).toEqual(projected.items);
});
