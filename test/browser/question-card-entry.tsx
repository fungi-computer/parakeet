import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as Schema from "effect/Schema";
import { defineClientEntry } from "@fungi.computer/shiitake/client-entry";
import { ExtensionId, type Json } from "@fungi.computer/shiitake/extensions";
import type {
  SessionExtensionSlots,
  SessionFrame,
} from "@fungi.computer/shiitake/client";

import { Parakeet } from "../../src/parakeet.js";
import type { ParakeetSession } from "../../src/session.js";
import {
  commandHandler,
  commandResult,
  sessionFrame,
  sessionSnapshot,
} from "../fixtures/session.fixture.js";

const host = document.querySelector<HTMLElement>("#root");
if (host === null) throw new Error("question card fixture root is missing");

// One ask, asked by one tool call. The client entry is the question
// extension's shape: a card while the ask is open, and afterwards the person's
// answer to that call in their own words.
type Phase = "quiet" | "asking" | "answered";
const callId = "call-ask";

const entry = defineClientEntry(
  {
    id: ExtensionId.make("question-proof"),
    commands: {},
    projection: { schema: Schema.String },
  },
  {
    describeToolCall: (id, view) =>
      view.status === "running" && view.value === "answered" && id === callId
        ? { text: "Explore together", own: true }
        : undefined,
    contribute: (view) => ({
      chips: [],
      panel:
        view.status !== "running" || view.value !== "asking"
          ? []
          : [
              {
                id: "ask-1",
                title: "What brings you here?",
                detail: "Explore together · Plan a project",
                tone: "attention",
                actions: [
                  {
                    id: "answerFlow",
                    label: "Answer",
                    input: { askId: "ask-1", toolCallId: callId },
                    awaiting: "question",
                  },
                ],
              },
            ],
      timeline: { cells: [], omitted: 0 },
      waiting: null,
    }),
  },
);

const slots = (phase: Phase): SessionExtensionSlots => ({
  "question-proof": {
    status: "running",
    revision: `sha256:${phase}`,
    value: phase,
    catalog: {
      protocol: "whistle.catalog/v1",
      commands: [
        { id: "answerFlow", title: "Answer", category: "Conversation" },
      ],
    },
  },
});

const decision: Json = {
  type: "prompt",
  prompt: {
    type: "decision",
    message: "What brings you here?",
    options: [
      {
        value: "Explore together",
        label: "Explore together",
        description: "I will share my goal in my own words.",
      },
      {
        value: "Plan a project",
        label: "Plan a project",
        description: "Start from something I want to build.",
      },
    ],
    other: { label: "Other…", maxLength: 100 },
  },
  next: {
    arguments: {
      stage: "decision",
      askId: "ask-1",
      requestId: "r",
      index: 0,
      answers: {},
    },
    answer: "answer",
  },
};

const usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
const history = [
  {
    id: "user-1",
    commandId: "c1",
    sequence: 1,
    value: { role: "user" as const, content: "Set me up", timestamp: 1 },
  },
  {
    id: "assistant-1",
    commandId: "c1",
    sequence: 2,
    value: {
      role: "assistant" as const,
      api: "pi",
      provider: "faux",
      model: "faux",
      content: [
        {
          type: "text" as const,
          text: "First I would like to know what brings you here.",
        },
        {
          type: "toolCall" as const,
          id: callId,
          name: "execute",
          arguments: { code: "return await env.question.ask({});" },
        },
      ],
      stopReason: "toolUse" as const,
      timestamp: 2,
      usage,
    },
  },
];
const result = {
  id: "result-1",
  commandId: null,
  sequence: 3,
  value: {
    role: "toolResult" as const,
    toolCallId: callId,
    toolName: "execute",
    content: [{ type: "text" as const, text: "Explore together" }],
    isError: false,
    timestamp: 3,
  },
};

const isAnswer = Schema.is(
  Schema.Struct({ stage: Schema.Literal("decision"), answer: Schema.Unknown }),
);

const waiting: ((result: IteratorResult<SessionFrame>) => void)[] = [];
const queued: SessionFrame[] = [];
const changes: AsyncIterable<SessionFrame> = {
  [Symbol.asyncIterator]: () => ({
    next: () => {
      const frame = queued.shift();
      return frame === undefined
        ? new Promise((resolve) => waiting.push(resolve))
        : Promise.resolve({ done: false, value: frame });
    },
    return: () => Promise.resolve({ done: true, value: undefined }),
  }),
};
const push = (phase: Phase, messages: typeof history | [typeof result]) => {
  const frame = sessionFrame({
    kind: "update",
    delivery: "live",
    cursor: null,
    messages,
    terminals: [],
    status: "idle",
    pending: { total: 0, prompts: [], hasMore: false },
    extensions: slots(phase),
  });
  const resolve = waiting.shift();
  if (resolve === undefined) queued.push(frame);
  else resolve({ done: false, value: frame });
};
// The Agent asks: its turn is already on the page, then the card opens.
Reflect.set(globalThis, "setAsking", (asking: boolean) => {
  push(asking ? "asking" : "quiet", []);
});

// "?empty" opens the conversation before anything is said, for its starter text.
const snapshot = sessionSnapshot({
  extensions: slots("quiet"),
  messages: globalThis.location.search === "?empty" ? [] : history,
});
const session: ParakeetSession = {
  address: "test://question-card",
  latestPending: () => Promise.resolve(null),
  withdraw: () => Promise.resolve({ status: "unknown" }),
  command: commandHandler(commandResult),
  // Sending the answer closes the ask and returns its result to the Agent.
  extension: () => ({
    call: (_command: string, args: Json) => {
      const answered = isAnswer(args);
      if (answered) {
        push("answered", [result]);
        return Promise.resolve({
          type: "done",
          notice: { type: "success", message: "Answer sent." },
        });
      }
      return Promise.resolve(decision);
    },
  }),
  read: () => Promise.resolve(snapshot),
  watch: () =>
    Promise.resolve({ snapshot, changes, close: () => Promise.resolve() }),
};

createRoot(host).render(
  <QueryClientProvider client={new QueryClient()}>
    <Parakeet session={session} clients={[entry]} />
  </QueryClientProvider>,
);
