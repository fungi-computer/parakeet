// @vitest-environment jsdom
// An extension that presents its own prompts in the footer leaves the timeline;
// stored messages stay, and a person's identical text is still theirs.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import * as Schema from "effect/Schema";
import { defineClientEntry } from "@fungi.computer/shiitake/client-entry";
import { ExtensionId } from "@fungi.computer/shiitake/extensions";
import type { SessionMessage } from "@fungi.computer/shiitake/client";
import { Parakeet } from "../src/parakeet.js";
import type { ParakeetSession } from "../src/session.js";
import {
  commandHandler,
  commandResult,
  sessionSnapshot,
} from "./fixtures/session.fixture.js";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});

const owner = ExtensionId.make("footer-owner");
const entry = defineClientEntry(
  {
    id: owner,
    commands: {},
    projection: { schema: Schema.String },
  },
  {
    promptPresentation: "footer",
    contribute: () => ({
      chips: [],
      panel: [],
      timeline: { cells: [], omitted: 0 },
      waiting: null,
    }),
  },
);

const prompt = (
  id: string,
  sequence: number,
  content: string,
): SessionMessage => ({
  id,
  sequence,
  commandId: id,
  value: { role: "user", content, timestamp: sequence },
});
const automated = (
  id: string,
  sequence: number,
  content: string,
): SessionMessage => ({
  ...prompt(id, sequence, content),
  origin: { extensionId: owner, correlation: null },
});

async function mount(
  messages: SessionMessage[],
  hasMore: boolean,
  failOlder = false,
) {
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(800);
  const snapshot = sessionSnapshot({
    messages,
    hasMore,
    oldestCursor: hasMore ? "older" : null,
  });
  const requests: unknown[] = [];
  const session: ParakeetSession = {
    latestPending: () => Promise.resolve(null),
    withdraw: () => Promise.resolve({ status: "unknown" }),
    address: "test://footer-prompts",
    command: commandHandler(commandResult),
    extension: () => ({
      call: () => Promise.resolve({ type: "done", result: null }),
    }),
    read: (input) => {
      requests.push(input);
      return failOlder
        ? Promise.reject(new Error("history unavailable"))
        : Promise.resolve(snapshot);
    },
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
  const query = new QueryClient();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const settle = async (operation?: () => void) =>
    act(async () => {
      operation?.();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
  await settle(() => {
    root.render(
      <QueryClientProvider client={query}>
        <Parakeet session={session} clients={[entry]} />
      </QueryClientProvider>,
    );
  });
  await settle();
  return {
    container,
    requests,
    settle,
    close: async () => {
      await settle(() => {
        root.unmount();
      });
      container.remove();
      query.clear();
    },
  };
}

it("hides the extension's prompt but keeps a person's identical text", async () => {
  const view = await mount(
    [
      automated("auto", 1, "Check the kiln"),
      prompt("human", 2, "Check the kiln"),
    ],
    false,
  );
  try {
    const rows = view.container.querySelectorAll(
      '[data-parakeet-entry="user"]',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.getAttribute("data-parakeet-id")).toBe("human");
  } finally {
    await view.close();
  }
});

it("shows no empty-conversation state while only hidden prompts are loaded and older history remains", async () => {
  const view = await mount([automated("auto", 1, "Check the kiln")], true);
  try {
    expect(view.container.textContent).not.toContain(
      "What would you like to build?",
    );
    expect(view.requests[0]).toMatchObject({ before: "older" });
    expect(
      view.container.querySelectorAll('[data-parakeet-entry="user"]'),
    ).toHaveLength(0);
  } finally {
    await view.close();
  }
});

it("does not retry a failed older-page fetch in a loop", async () => {
  const view = await mount(
    [automated("auto", 1, "Check the kiln")],
    true,
    true,
  );
  try {
    for (let tick = 0; tick < 10; tick++) await view.settle();
    expect(view.requests).toHaveLength(1);
  } finally {
    await view.close();
  }
});
