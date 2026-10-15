import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
  PromptCommand,
  SessionFrame,
  SessionWatch,
} from "@fungi.computer/shiitake/client";
import { z } from "zod";
import type { ParakeetSession } from "../../src/session.js";

import { Parakeet } from "../../src/index.js";
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
const commands: PromptCommand[] = [];
let attempts = 0;
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
const initialHistory = Array.from({ length: 24 }, (_, index) => ({
  id: `browser-history-${String(index + 1)}`,
  sequence: index + 1,
  commandId: `browser-history-command-${String(index + 1)}`,
  value: {
    role: "user" as const,
    content: `Retained history message ${String(index + 1)}. This row makes the initial conversation taller than its viewport.`,
    timestamp: index + 1,
  },
}));

let sequence = initialHistory.length;
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
  address: "test://parakeet/browser-session",
  command: commandHandler(
    (input) => {
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
            text: "I will inspect that.",
            thinking: "checking",
            textTruncated: false,
            thinkingTruncated: false,
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
  read: () =>
    Promise.resolve(
      sessionSnapshot({
        sessionId: "browser-session",
        messages: initialHistory,
        extensions: goalSlots(goal),
      }),
    ),
  watch: (): Promise<SessionWatch> =>
    Promise.resolve({
      snapshot: sessionSnapshot({
        sessionId: "browser-session",
        messages: initialHistory,
        extensions: goalSlots(goal),
      }),
      changes,
      close: () => Promise.resolve(),
    }),
};

const queryClient = new QueryClient();

Object.assign(window, {
  __parakeetBrowserProof: {
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
    commands,
  },
});

const root = document.getElementById("root");
if (root === null) throw new Error("browser contract root is missing");
createRoot(root).render(
  <QueryClientProvider client={queryClient}>
    <Parakeet session={session} clients={probeClients} />
  </QueryClientProvider>,
);
