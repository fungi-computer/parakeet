// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ParakeetProvider, useTimeline } from "../src/headless.js";
import { ExtensionId } from "@fungi.computer/shiitake/extensions";
import type { ClientEntryV1 } from "@fungi.computer/shiitake/client-entry";
import {
  createParakeetInteractions,
  type ParakeetInteractions,
} from "../src/commands/interactions.js";
import type { ParakeetSession } from "../src/session.js";
import {
  commandHandler,
  commandResult,
  noExtension,
  sessionSnapshot,
} from "./fixtures/session.fixture.js";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});

const origin = { extensionId: "botanical-session-question", correlation: "a1" };
const asked = "Answer to ask a1:\nQ (q): Which?\nSelected: Delete my files";

function Texts() {
  return useTimeline().settled.map((item) =>
    item.kind === "user_message" ? (
      <p data-outcome={item.outcome === undefined ? "no" : "yes"} key={item.id}>
        {item.text}
      </p>
    ) : null,
  );
}

async function paragraphs(
  describeMessage: NonNullable<ClientEntryV1["describeMessage"]>,
  store: ParakeetInteractions = createParakeetInteractions(),
): Promise<readonly [string | null, string | null, string | null]> {
  const snapshot = sessionSnapshot({
    messages: [
      {
        id: "m1",
        commandId: "c1",
        sequence: 1,
        origin,
        value: { role: "user", content: asked, timestamp: 1 },
      },
      {
        id: "m2",
        commandId: "c2",
        sequence: 2,
        value: { role: "user", content: asked, timestamp: 2 },
      },
    ],
  });
  const session: ParakeetSession = {
    address: "test://describe-message",
    latestPending: () => Promise.resolve(null),
    withdraw: () => Promise.resolve({ status: "unknown" }),
    command: commandHandler(commandResult),
    extension: noExtension,
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
  const entry: ClientEntryV1 = {
    protocol: "shiitake.client/v1",
    id: ExtensionId.make("botanical-session-question"),
    contribute: () => ({
      chips: [],
      panel: [],
      timeline: { cells: [], omitted: 0 },
      waiting: null,
    }),
    describeMessage,
  };
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <ParakeetProvider
            session={session}
            clients={[entry]}
            interactionStore={store}
          >
            <Texts />
          </ParakeetProvider>
        </QueryClientProvider>,
      );
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(container.querySelectorAll("p")).toHaveLength(2);
    });
    const [described, typed] = [...container.querySelectorAll("p")];
    return [
      described?.textContent ?? null,
      described?.getAttribute("data-outcome") ?? null,
      typed?.textContent ?? null,
    ];
  } finally {
    act(() => {
      root.unmount();
    });
    client.clear();
    container.remove();
  }
}

it("shows what an extension says a message means, never the text the Agent reads", async () => {
  const [text, outcome, typed] = await paragraphs((from) =>
    from.correlation === "a1" ? "Work on a project" : undefined,
  );
  expect(text).toBe("Work on a project");
  expect(outcome).toBe("yes");
  // A person's own prompt with the same words stays what it is.
  expect(typed).toContain("Selected: Delete my files");
});

it("keeps the original message when an entry's description throws, and toasts once without the raw error", async () => {
  const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const store = createParakeetInteractions();
  const toasts: string[] = [];
  store.subscribeToasts((toast) => {
    expect(toast.variant).toBe("error");
    toasts.push(toast.message);
  });
  try {
    const [text, outcome] = await paragraphs(() => {
      throw new Error("boom");
    }, store);
    expect(text).toBe(asked);
    expect(outcome).toBe("no");
    // The raw error goes to the log only; the person reads plain words.
    expect(spy).toHaveBeenCalled();
    expect(toasts).toEqual([
      "botanical-session-question couldn't describe a message; showing it as sent.",
    ]);
    expect(store.snapshot().notice).toBeUndefined();
  } finally {
    spy.mockRestore();
  }
});

it("keeps the original message when a description is not a short string", async () => {
  const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    // SAFETY: the test hands a host a hook that breaks its declared return type on purpose.
    const [number] = await paragraphs(() => JSON.parse("42") as string);
    expect(number).toBe(asked);
    const [long] = await paragraphs(() => "x".repeat(501));
    expect(long).toBe(asked);
    const [empty] = await paragraphs(() => "");
    expect(empty).toBe(asked);
  } finally {
    spy.mockRestore();
  }
});
