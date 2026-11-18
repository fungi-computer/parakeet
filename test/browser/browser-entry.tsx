import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  ShiitakeError,
  type PromptCommand,
  type SessionFrame,
  type SessionSnapshot,
  type SessionWatch,
} from "@fungi.computer/shiitake/client";
import { z } from "zod";
import type { ParakeetSession } from "../../src/session.js";

import {
  ParakeetProvider,
  ParakeetView,
  useStatus,
  useTimeline,
} from "../../src/index.js";
import type { ParakeetToast } from "../../src/headless.js";
import {
  commandHandler,
  commandResult,
  committedGoal,
  extensionCalls,
  goalSlots,
  goalContract,
  probeClients,
  sessionFrame,
  sessionSnapshot,
  runningFacts,
  idleFacts,
  type FixtureGoal,
} from "../fixtures/session.fixture.js";

type FrameQueue = AsyncIterable<SessionFrame> & {
  push: (frame: SessionFrame) => void;
};

function frameQueue(): FrameQueue {
  const queued: SessionFrame[] = [];
  const waiting: ((result: IteratorResult<SessionFrame>) => void)[] = [];
  const iterator: AsyncIterator<SessionFrame> = {
    next: () => {
      const frame = queued.shift();
      if (frame !== undefined)
        return Promise.resolve({ done: false, value: frame });
      return new Promise((resolve) => {
        waiting.push(resolve);
      });
    },
    return: () => Promise.resolve({ done: true, value: undefined }),
  };
  return {
    [Symbol.asyncIterator]: () => iterator,
    push: (frame) => {
      const resolve = waiting.shift();
      if (resolve === undefined) queued.push(frame);
      else resolve({ done: false, value: frame });
    },
  };
}

const changes = frameQueue();
let liveBaseline: SessionSnapshot | undefined;
const commands: PromptCommand[] = [];
let attempts = 0;
/** Times the person chose the key settings link from a refusal toast. */
let settingsOpened = 0;
/**
 * The owner's refusal of a prompt holding a secret. Shiitake's own tests
 * prove the refusal; this contract proves how Parakeet shows it.
 */
const refusedSecret = "VAULTCANARY";
let aborts = 0;
let goal: FixtureGoal = {
  revision: "browser-goal-revision",
  objective: "Make browser goals useful without interrupting current work",
  state: "active",
};
let pauses = 0;
let resumes = 0;
function observeGoal(state: FixtureGoal["state"]): FixtureGoal {
  goal = { ...goal, state };
  changes.push(
    sessionFrame({
      kind: "update",
      delivery: "live",
      cursor: null,
      messages: [],
      terminals: [],
      status: "idle",
      pending: { total: 0, prompts: [], hasMore: false },
      extensions: goalSlots(goal),
    }),
  );
  return goal;
}
const markdownProof = [
  "---",
  "Conversation text between rules.",
  "---",
  "",
  "Plain Markdown proof.",
  "",
  "\\*escaped Markdown proof\\*",
  "",
  '```ts title="proof.ts"',
  "const answer: number = 42;",
  `const longLine = "${"readable".repeat(40)}";`,
  "```",
].join("\n");
const usage = {
  input: 1,
  output: 1,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 2,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  },
};
// `?paged` serves the latest 24 rows plus six older pages of 100 rows, so a
// reader can load past the history window and have the newest page evicted.
const paged = globalThis.location.search === "?paged";
const pageCount = 6;
const pageSize = 100;
const initialHistory = Array.from({ length: 24 }, (_, index) => ({
  id: `browser-history-${String(index + 1)}`,
  sequence: (paged ? 1000 : 0) + index + 1,
  commandId: `browser-history-command-${String(index + 1)}`,
  value: {
    role: "user" as const,
    content: `Retained history message ${String(index + 1)}. This row makes the initial conversation taller than its viewport.`,
    timestamp: index + 1,
  },
}));
// Live rows must sort after the paged history rows.
const liveBase = paged ? 2000 : 0;
const latestPaging = paged ? { oldestCursor: `page-${String(pageCount)}` } : {};

function olderPage(before: string) {
  const page = Number(before.slice("page-".length));
  return sessionSnapshot({
    sessionId: "browser-session",
    messages: Array.from({ length: pageSize }, (_, index) => ({
      id: `paged-history-${String(page)}-${String(index)}`,
      sequence: page * pageSize + index,
      commandId: `paged-history-command-${String(page)}-${String(index)}`,
      value: {
        role: "user" as const,
        content: `Older page ${String(page)} message ${String(index)}.`,
        timestamp: page * pageSize + index,
      },
    })),
    oldestCursor: page > 1 ? `page-${String(page - 1)}` : null,
  });
}

let sequence = initialHistory.at(-1)?.sequence ?? 0;
function nextSequence(): number {
  sequence += 1;
  return sequence;
}

function complete(): void {
  changes.push(
    sessionFrame({
      pending: { total: 0, prompts: [], hasMore: false },
      kind: "update",
      delivery: "live",
      cursor: "browser-cursor-3",
      terminals: [],
      messages: [
        {
          id: "browser-assistant",
          sequence: nextSequence(),
          commandId: null,
          value: {
            role: "assistant",
            api: "pi",
            provider: "camel",
            model: "auto",
            content: [
              { type: "thinking", thinking: "checking" },
              { type: "text", text: markdownProof },
              {
                type: "toolCall",
                id: "browser-call",
                name: "execute",
                arguments: {
                  code: "const result = await computer.read('README.md');\nreturn result;",
                },
              },
            ],
            stopReason: "toolUse",
            timestamp: sequence,
            usage,
          },
        },
        {
          id: "browser-result",
          sequence: nextSequence(),
          commandId: null,
          value: {
            role: "toolResult",
            toolCallId: "browser-call",
            toolName: "execute",
            content: [{ type: "text", text: "read complete" }],
            isError: false,
            timestamp: sequence,
          },
        },
      ],
      status: "idle",
      extensions: goalSlots(goal),
    }),
  );
}

function receiveRemotePrompt(): void {
  changes.push(
    sessionFrame({
      pending: { total: 0, prompts: [], hasMore: false },
      kind: "update",
      delivery: "live",
      cursor: "browser-remote-cursor",
      terminals: [],
      messages: [
        {
          id: "browser-remote-user",
          sequence: nextSequence(),
          commandId: "browser-remote-command",
          value: {
            role: "user",
            content: "A remote prompt arrived while this reader was away.",
            timestamp: sequence,
          },
        },
      ],
      status: "queued",
      extensions: goalSlots(goal),
    }),
  );
}

function terminateLatestRun(outcome: "failed" | "cancelled"): void {
  const requestId = commands.at(-1)?.requestId;
  if (requestId === undefined)
    throw new Error("No accepted prompt to terminate");
  changes.push(
    sessionFrame({
      pending: { total: 0, prompts: [], hasMore: false },
      kind: "update",
      delivery: "live",
      cursor: `browser-${requestId}-${outcome}-cursor`,
      messages: [],
      terminals: [{ commandId: requestId, outcome, sequence: nextSequence() }],
      status: "idle",
    }),
  );
}

const session: ParakeetSession = {
  latestPending: () => Promise.resolve(null),
  withdraw: () => Promise.resolve({ status: "unknown" }),
  address: "test://parakeet/browser-session",
  command: commandHandler(
    (input) => {
      if (input.text.includes(refusedSecret))
        return Promise.reject(
          new ShiitakeError(
            "contract",
            "secret_in_prompt",
            "This message contains a key or password, so it was not sent or saved.",
          ),
        );
      commands.push(input);
      attempts += 1;
      if (attempts === 1)
        return Promise.reject(new Error("first typed command failed"));

      changes.push(
        sessionFrame({
          pending: { total: 0, prompts: [], hasMore: false },
          kind: "update",
          delivery: "live",
          cursor: `browser-admission-${String(attempts)}`,
          terminals: [],
          messages: [
            {
              id:
                attempts === 2
                  ? "browser-user"
                  : `browser-user-${String(attempts)}`,
              sequence: nextSequence(),
              commandId: input.requestId,
              value: { role: "user", content: input.text, timestamp: sequence },
            },
          ],
          extensions: goalSlots(goal),
          status: "thinking",
        }),
      );
      changes.push(
        sessionFrame({
          kind: "progress",
          status: "streaming",
          progress: {
            messageId: "browser-assistant",
            revision: 1,
            text: { offset: 0, append: "I will inspect that." },
            thinking: { offset: 0, append: "checking" },
          },
        }),
      );
      return commandResult(input);
    },
    (input) => {
      aborts += 1;
      return commandResult(input);
    },
  ),
  extension: extensionCalls({
    [goalContract.id]: {
      change: (raw) => {
        const { action } = z
          .object({ action: z.enum(["pause", "resume"]) })
          .parse(raw);
        if (action === "pause") pauses += 1;
        else {
          resumes += 1;
          if (resumes === 1)
            return Promise.reject(new Error("Resume temporarily rejected"));
        }
        return Promise.resolve({
          type: "done",
          result: committedGoal(
            observeGoal(action === "pause" ? "paused" : "active"),
          ),
        });
      },
    },
  }),
  read: (options) =>
    Promise.resolve(
      (options?.before === undefined ? undefined : olderPage(options.before)) ??
        liveBaseline ??
        sessionSnapshot({
          sessionId: "browser-session",
          messages: initialHistory,
          ...latestPaging,
          extensions: goalSlots(goal),
        }),
    ),
  watch: (): Promise<SessionWatch> =>
    Promise.resolve({
      snapshot:
        liveBaseline ??
        sessionSnapshot({
          sessionId: "browser-session",
          messages: initialHistory,
          ...latestPaging,
          extensions: goalSlots(goal),
        }),
      changes,
      close: () => Promise.resolve(),
    }),
};

const queryClient = new QueryClient();

let liveRevision = 0;
const liveActivity = runningFacts({ activeTool: "execute" });
function updateLiveOutput(count: number, droppedBytes = 0): number {
  liveRevision += 1;
  const frame: Extract<SessionFrame, { kind: "tool_output" }> = {
    kind: "tool_output",
    activity: liveActivity,
    toolOutput: [
      {
        toolCallId: "live-build",
        revision: liveRevision,
        tail: Array.from(
          { length: count },
          (_, index) =>
            `build step ${String(index + 1)}: ${"compiling ".repeat(10)}`,
        ).join("\n"),
        droppedBytes,
        totalBytes: droppedBytes + 8192,
      },
    ],
  };
  if (liveBaseline === undefined) throw new Error("Begin live output first");
  liveBaseline = {
    ...liveBaseline,
    activity: frame.activity,
    toolOutput: frame.toolOutput,
  };
  changes.push(frame);
  return liveRevision;
}

function beginLiveOutput(): void {
  liveRevision = 0;
  liveBaseline = sessionSnapshot({
    sessionId: "browser-session",
    activity: liveActivity,
    messages: [
      ...Array.from({ length: 30 }, (_, index) => ({
        id: `live-history-${String(index)}`,
        sequence: liveBase + index + 1,
        commandId: null,
        value: {
          role: "user" as const,
          content: `Earlier conversation ${String(index)}`,
          timestamp: index,
        },
      })),
      {
        id: "live-prompt",
        sequence: liveBase + 31,
        commandId: "running-command",
        value: { role: "user", content: "Run the build.", timestamp: 31 },
      },
      {
        id: "live-assistant",
        sequence: liveBase + 32,
        commandId: "running-command",
        value: {
          role: "assistant",
          api: "pi",
          provider: "faux",
          model: "faux",
          usage,
          stopReason: "toolUse",
          timestamp: 32,
          content: [
            {
              type: "toolCall",
              id: "live-build",
              name: "execute",
              arguments: {
                code: "return await env.computers.local.exec({command:'build'});",
              },
            },
          ],
        },
      },
    ],
  });
  changes.push({
    kind: "reset",
    reason: "history_unavailable",
    cursor: null,
    baseline: liveBaseline,
  });
  updateLiveOutput(1);
}

function finishLiveOutput(isError: boolean): void {
  const frame = sessionFrame({
    kind: "update",
    delivery: "live",
    cursor: "live-result",
    status: "idle",
    messages: [
      {
        id: "live-result",
        sequence: 33,
        commandId: "running-command",
        value: {
          role: "toolResult",
          toolCallId: "live-build",
          toolName: "execute",
          isError,
          timestamp: 33,
          content: [
            {
              type: "text",
              text: JSON.stringify({
                stdout: "Final build output",
                stderr: isError ? "Compiler failed" : "",
                exitCode: isError ? 1 : 0,
              }),
            },
          ],
        },
      },
    ],
    terminals: [],
    pending: { total: 0, prompts: [], hasMore: false },
  });
  if (frame.kind !== "update" || liveBaseline === undefined)
    throw new Error("Begin live output first");
  liveBaseline = sessionSnapshot({
    ...liveBaseline,
    activity: idleFacts,
    messages: [...liveBaseline.messages, ...frame.messages],
    toolOutput: [],
  });
  changes.push(frame);
}

Object.assign(window, {
  __parakeetBrowserProof: {
    beginLiveOutput,
    updateLiveOutput,
    finishLiveOutput,
    complete,
    terminateLatestRun,
    receiveRemotePrompt,
    get pauses() {
      return pauses;
    },
    get resumes() {
      return resumes;
    },
    get aborts() {
      return aborts;
    },
    get attempts() {
      return attempts;
    },
    get settingsOpened() {
      return settingsOpened;
    },
    commands,
  },
});

const root = document.getElementById("root");
if (root === null) throw new Error("browser contract root is missing");
function LiveRevision() {
  const { settled } = useTimeline();
  const { observation } = useStatus();
  const revision =
    settled.flatMap((item) =>
      item.kind === "tool_group"
        ? item.calls.flatMap((call) =>
            call.live === undefined ? [] : [call.live.revision],
          )
        : [],
    )[0] ?? 0;
  return (
    <output className="sr-only" aria-label="Observed tool output revision">
      {observation.status === "live" ? revision : observation.status}
    </output>
  );
}
/**
 * The proof's toast surface, standing in for a host's. It draws a toast that
 * offers an action, so the refusal's settings link is clickable; others are
 * not part of this contract.
 */
const toastListeners = new Set<(toast: ParakeetToast) => void>();
function showToast(toast: ParakeetToast): void {
  for (const listener of toastListeners) listener(toast);
}
function ProofToasts() {
  const [toast, setToast] = useState<ParakeetToast>();
  useEffect(() => {
    const listener = (next: ParakeetToast) => {
      if (next.action !== undefined) setToast(next);
    };
    toastListeners.add(listener);
    return () => {
      toastListeners.delete(listener);
    };
  }, []);
  if (toast?.action === undefined) return null;
  const { action } = toast;
  return (
    <div
      role="status"
      data-proof-toast={toast.variant}
      style={{ position: "fixed", top: 8, right: 8, zIndex: 10 }}
    >
      {toast.message}
      <button
        type="button"
        onClick={() => {
          action.onSelect();
          setToast(undefined);
        }}
      >
        {action.label}
      </button>
    </div>
  );
}
const hostFacts = {
  modelSetup: {
    state: "ready",
    fix: {
      label: "Add a model key",
      onSelect: () => {
        settingsOpened += 1;
      },
    },
  },
} as const;
createRoot(root).render(
  <QueryClientProvider client={queryClient}>
    <ParakeetProvider
      session={session}
      clients={probeClients}
      onToast={showToast}
    >
      <ParakeetView hostFacts={hostFacts} />
      <LiveRevision />
    </ParakeetProvider>
    <ProofToasts />
  </QueryClientProvider>,
);
