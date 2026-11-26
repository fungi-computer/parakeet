// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import * as Schema from "effect/Schema";
import { defineClientEntry } from "@fungi.computer/shiitake/client-entry";
import { ExtensionId, type Json } from "@fungi.computer/shiitake/extensions";
import type { SessionExtensionSlots } from "@fungi.computer/shiitake/client";
import { Parakeet } from "../src/parakeet.js";
import type { ParakeetSession } from "../src/session.js";
import {
  commandHandler,
  commandResult,
  runningFacts,
  sessionSnapshot,
} from "./fixtures/session.fixture.js";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});

// A question row whose action input names the tool call that asked, the way the
// question extension's client publishes it.
const entry = defineClientEntry(
  {
    id: ExtensionId.make("ask-call-proof"),
    commands: {},
    projection: { schema: Schema.String },
  },
  {
    contribute: () => ({
      chips: [],
      panel: [
        {
          id: "ask-1",
          title: "Which color should we use?",
          detail: "Blue · Green",
          tone: "attention",
          actions: [
            {
              id: "answerFlow",
              label: "Answer",
              input: { askId: "ask-1", toolCallId: "call-ask" },
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

const slots: SessionExtensionSlots = {
  "ask-call-proof": {
    status: "running",
    revision: "sha256:asking",
    value: "ask-1",
    catalog: {
      protocol: "whistle.catalog/v1",
      commands: [
        { id: "answerFlow", title: "Answer", category: "Conversation" },
      ],
    },
  },
};

const decision: Json = {
  type: "prompt",
  prompt: {
    type: "decision",
    message: "Which color should we use?",
    options: [
      { value: "Blue", label: "Blue", description: "Use the blue theme" },
      { value: "Green", label: "Green", description: "Use the green theme" },
    ],
  },
  next: {
    arguments: {
      stage: "decision",
      askId: "ask-1",
      requestId: "request-1",
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

function call(id: string) {
  return {
    type: "toolCall" as const,
    id,
    name: "execute",
    arguments: { code: `return "${id}";` },
  };
}

it("marks only the call that asked as waiting, from the row's own tool call id", async () => {
  const snapshot = sessionSnapshot({
    extensions: slots,
    activity: runningFacts({ activeTool: "execute" }),
    messages: [
      {
        id: "user",
        commandId: "running-command",
        sequence: 1,
        value: { role: "user", content: "Go", timestamp: 1 },
      },
      {
        id: "assistant",
        commandId: "running-command",
        sequence: 2,
        value: {
          role: "assistant",
          api: "pi",
          provider: "faux",
          model: "faux",
          content: [call("call-ask")],
          stopReason: "toolUse",
          timestamp: 2,
          usage,
        },
      },
    ],
  });
  const session: ParakeetSession = {
    latestPending: () => Promise.resolve(null),
    withdraw: () => Promise.resolve({ status: "unknown" }),
    address: "test://awaiting-tool-call",
    command: commandHandler(commandResult),
    extension: () => ({ call: vi.fn(() => Promise.resolve(decision)) }),
    read: () => Promise.resolve(snapshot),
    watch: () =>
      Promise.resolve({
        snapshot,
        changes: {
          [Symbol.asyncIterator]: () => ({
            next: () => new Promise(() => undefined),
          }),
        },
        close: () => Promise.resolve(),
      }),
  };
  // jsdom has no layout; the timeline's virtual list needs a size to draw rows.
  const height = vi
    .spyOn(HTMLElement.prototype, "offsetHeight", "get")
    .mockReturnValue(800);
  const width = vi
    .spyOn(HTMLElement.prototype, "offsetWidth", "get")
    .mockReturnValue(800);
  const query = new QueryClient();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(
        <QueryClientProvider client={query}>
          <Parakeet session={session} clients={[entry]} />
        </QueryClientProvider>,
      );
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
    await vi.waitFor(async () => {
      await act(async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      });
      // The card is open, and the call it names is waiting on the answer.
      expect(
        container.querySelector('[role="group"][data-kind]'),
      ).not.toBeNull();
      expect(container.textContent).toContain("Waiting for your answer");
    });
  } finally {
    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
    query.clear();
    container.remove();
    height.mockRestore();
    width.mockRestore();
  }
});
