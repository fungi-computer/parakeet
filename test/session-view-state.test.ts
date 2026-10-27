import type {
  SessionActivity,
  SessionProgress,
  SessionTerminal,
} from "@fungi.computer/shiitake/client";
import { expect, it } from "vitest";

import {
  sameSessionViewState,
  sessionActivityStatus,
  sessionViewState,
  type SessionViewFacts,
  type SessionViewState,
} from "../src/core/session-view-state.js";
import {
  idleFacts,
  queuedFacts,
  runningFacts,
} from "./fixtures/session.fixture.js";

const progress = (text: string): SessionProgress => ({
  messageId: "assistant-1",
  revision: 1,
  text,
  thinking: "",
  textTruncated: false,
  thinkingTruncated: false,
});

const terminal = (
  outcome: SessionTerminal["outcome"],
  sequence: number,
  diagnostic: string | null = null,
): SessionTerminal => ({
  commandId: "command-" + String(sequence),
  outcome,
  sequence,
  diagnostic,
});

const facts = (
  activity: SessionActivity,
  terminals: readonly SessionTerminal[] = [],
  active: SessionProgress | null = null,
): SessionViewFacts => ({ activity, terminals, progress: active });

const retry = {
  attempt: 2,
  maxAttempts: 4,
  delayMs: 3_000,
  errorMessage: "503 Service Unavailable",
  scheduledAt: 10_000,
};

// Each row reproduces a label the TUI shows today, from raw facts alone.
const table: readonly (readonly [
  string,
  SessionViewFacts,
  SessionViewState,
])[] = [
  ["nothing has happened", facts(idleFacts), { kind: "idle" }],
  [
    "waiting in the queue",
    facts(queuedFacts("queued-1")),
    { kind: "queued", queuedCommandId: "queued-1", runningWork: null },
  ],
  [
    "cancelling queued work",
    facts({ ...queuedFacts("queued-1"), cancellationRequested: true }),
    { kind: "cancelling" },
  ],
  [
    "cancelling running work",
    facts(runningFacts({ cancellationRequested: true, retry })),
    { kind: "cancelling" },
  ],
  ["running with no output", facts(runningFacts()), { kind: "thinking" }],
  [
    "running with empty progress",
    facts(runningFacts(), [], progress("")),
    { kind: "thinking" },
  ],
  [
    "running with streamed text",
    facts(runningFacts(), [], progress("Hello")),
    { kind: "responding" },
  ],
  [
    "running a tool",
    facts(runningFacts({ activeTool: "execute" }), [], progress("Hello")),
    { kind: "running_tool", tool: "execute" },
  ],
  [
    "compacting on a threshold",
    facts(runningFacts({ compaction: { trigger: "threshold" } })),
    { kind: "compacting", trigger: "threshold" },
  ],
  [
    "a manual compaction outranks a stale active tool fact",
    facts(
      runningFacts({
        compaction: { trigger: "manual" },
        activeTool: "execute",
      }),
    ),
    { kind: "compacting", trigger: "manual" },
  ],
  [
    "waiting out a retry",
    facts(runningFacts({ retry, activeTool: "execute" })),
    {
      kind: "retrying",
      attempt: 2,
      maxAttempts: 4,
      cause: "503 Service Unavailable",
      nextRetryAt: 13_000,
    },
  ],
  [
    "a retry cause is collapsed and bounded to 160 characters",
    facts(
      runningFacts({
        retry: { ...retry, errorMessage: "  line one\n\n" + "x".repeat(300) },
      }),
    ),
    {
      kind: "retrying",
      attempt: 2,
      maxAttempts: 4,
      cause: ("line one " + "x".repeat(300)).slice(0, 160),
      nextRetryAt: 13_000,
    },
  ],
  [
    "a completed run waits for you",
    facts(idleFacts, [terminal("completed", 4)]),
    { kind: "waiting_for_you" },
  ],
  [
    "a cancelled run waits for you",
    facts(idleFacts, [terminal("cancelled", 4)]),
    { kind: "waiting_for_you" },
  ],
  [
    "a failed run shows its cause",
    facts(idleFacts, [terminal("failed", 4, "Model rejected this run")]),
    { kind: "error", cause: "Model rejected this run" },
  ],
  [
    "a failed run without a diagnostic",
    facts(idleFacts, [terminal("failed", 4)]),
    { kind: "error", cause: "Run failed without a diagnostic" },
  ],
  [
    "an interrupted run without a diagnostic",
    facts(idleFacts, [terminal("interrupted", 4)]),
    { kind: "error", cause: "Run was interrupted" },
  ],
  [
    "an error cause is collapsed and bounded to 200 characters",
    facts(idleFacts, [
      terminal("failed", 4, "first\n\tsecond   " + "y".repeat(400)),
    ]),
    {
      kind: "error",
      cause: ("first second " + "y".repeat(400)).slice(0, 200),
    },
  ],
  [
    "only the newest terminal counts",
    facts(idleFacts, [
      terminal("completed", 6),
      terminal("failed", 2, "old failure"),
    ]),
    { kind: "waiting_for_you" },
  ],
  [
    "a model choice after a failure acknowledges it",
    facts({ ...idleFacts, lastModelChoiceSequence: 5 }, [
      terminal("failed", 4, "Model rejected this run"),
    ]),
    { kind: "waiting_for_you" },
  ],
  [
    "a model choice before a failure does not acknowledge it",
    facts({ ...idleFacts, lastModelChoiceSequence: 3 }, [
      terminal("failed", 4, "Model rejected this run"),
    ]),
    { kind: "error", cause: "Model rejected this run" },
  ],
  [
    "a model choice with no run leaves the Session idle",
    facts({ ...idleFacts, lastModelChoiceSequence: 3 }),
    { kind: "idle" },
  ],
];

it.each(table)("decides %s", (_name, input, expected) => {
  expect(sessionViewState(input)).toEqual(expected);
});

it("removes terminal programs before preparing a bounded failure diagnostic", () => {
  const view = sessionViewState(
    facts(idleFacts, [
      terminal("failed", 4, "safe\u001b]52;c;Y21k\u0007\u009d\u202e end"),
    ]),
  );
  expect(view).toEqual({ kind: "error", cause: "safe end" });
});

it("derives the coarse composer status from the view state", () => {
  const status = (input: SessionViewFacts) =>
    sessionActivityStatus(sessionViewState(input));
  expect(status(facts(idleFacts))).toBe("idle");
  expect(status(facts(idleFacts, [terminal("failed", 4)]))).toBe("idle");
  expect(status(facts(queuedFacts()))).toBe("queued");
  expect(status(facts(runningFacts()))).toBe("thinking");
  expect(status(facts(runningFacts({ activeTool: "execute" })))).toBe(
    "thinking",
  );
  expect(status(facts(runningFacts(), [], progress("Hi")))).toBe("streaming");
  expect(status(facts(runningFacts({ retry })))).toBe("retrying");
  expect(status(facts(runningFacts({ cancellationRequested: true })))).toBe(
    "cancelling",
  );
  expect(
    status(facts(runningFacts({ compaction: { trigger: "overflow" } }))),
  ).toBe("thinking");
});

it("compares view states by what they say", () => {
  expect(
    sameSessionViewState(
      { kind: "queued", queuedCommandId: "a", runningWork: null },
      { kind: "queued", queuedCommandId: "a", runningWork: null },
    ),
  ).toBe(true);
  expect(
    sameSessionViewState(
      { kind: "queued", queuedCommandId: "a", runningWork: null },
      { kind: "queued", queuedCommandId: "b", runningWork: null },
    ),
  ).toBe(false);
  expect(
    sameSessionViewState({ kind: "thinking" }, { kind: "responding" }),
  ).toBe(false);
  expect(
    sameSessionViewState(
      { kind: "compacting", trigger: "manual" },
      { kind: "compacting", trigger: "manual" },
    ),
  ).toBe(true);
  expect(
    sameSessionViewState(
      { kind: "compacting", trigger: "manual" },
      { kind: "compacting", trigger: "threshold" },
    ),
  ).toBe(false);
  expect(
    sameSessionViewState(
      { kind: "error", cause: "a" },
      { kind: "error", cause: "b" },
    ),
  ).toBe(false);
});

it("changes the queued readout when the executor changes", () => {
  const queued = sessionViewState(facts(queuedFacts("next")));
  const behindSession = sessionViewState(
    facts({
      ...queuedFacts("next"),
      queue: {
        state: "queued",
        commandId: "next",
        runningWork: { kind: "session", sessionId: "a", commandId: "running" },
      },
    }),
  );
  expect(sameSessionViewState(queued, behindSession)).toBe(false);
  expect(
    sameSessionViewState(behindSession, {
      kind: "queued",
      queuedCommandId: "next",
      runningWork: { kind: "session", sessionId: "b", commandId: "running" },
    }),
  ).toBe(false);
  expect(
    sameSessionViewState(behindSession, {
      kind: "queued",
      queuedCommandId: "next",
      runningWork: { kind: "session", sessionId: "a", commandId: "running" },
    }),
  ).toBe(true);
});

it("compares host blocker facts without confusing them with a Session", () => {
  const queued = {
    kind: "queued",
    queuedCommandId: "next",
    runningWork: { kind: "host", lane: "delivery", jobId: "one" },
  } satisfies SessionViewState;
  expect(
    sameSessionViewState(queued, {
      ...queued,
      runningWork: { ...queued.runningWork },
    }),
  ).toBe(true);
  expect(
    sameSessionViewState(queued, {
      ...queued,
      runningWork: { ...queued.runningWork, lane: "cleanup" },
    }),
  ).toBe(false);
  expect(
    sameSessionViewState(queued, {
      ...queued,
      runningWork: { ...queued.runningWork, jobId: "two" },
    }),
  ).toBe(false);
  expect(sameSessionViewState(queued, { ...queued, runningWork: null })).toBe(
    false,
  );
  expect(
    sameSessionViewState(queued, {
      ...queued,
      runningWork: { kind: "session", sessionId: "delivery", commandId: "one" },
    }),
  ).toBe(false);
});
