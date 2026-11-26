// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ParakeetProvider, useTimeline } from "../src/headless.js";
import { ExtensionId } from "@fungi.computer/shiitake/extensions";
import type { ClientEntryV1 } from "@fungi.computer/shiitake/client-entry";
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
      <p data-outcome={item.outcome === true ? "yes" : "no"} key={item.id}>
        {item.text}
      </p>
    ) : null,
  );
}

it("shows what an extension says a message means, never the text the Agent reads", async () => {
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
    describeMessage: (from) =>
      from.correlation === "a1" ? "You chose: Work on a project" : undefined,
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
          <ParakeetProvider session={session} clients={[entry]}>
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
    expect(described?.textContent).toBe("You chose: Work on a project");
    expect(described?.getAttribute("data-outcome")).toBe("yes");
    // A person's own prompt with the same words stays what it is.
    expect(typed?.textContent).toContain("Selected: Delete my files");
    expect(typed?.getAttribute("data-outcome")).toBe("no");
  } finally {
    act(() => {
      root.unmount();
    });
    client.clear();
    container.remove();
  }
});
