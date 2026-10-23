import { createCapabilityRegistry } from "@fungi.computer/agar";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import {
  createConversationOpeningOwner,
  eventSourceFor,
  type OpenConversation,
  type OpeningServices,
  type PendingSelection,
} from "../src/conversation-opening.js";
import type { ParakeetSession } from "../src/headless.js";
import {
  commandHandler,
  commandResult,
  noExtension,
  sessionSnapshot,
} from "./fixtures/session.fixture.js";

describe("shared conversation opening", () => {
  it("streams Grove's and Stage's Session events through the host fetch", async () => {
    const requested: string[] = [];
    const Source = eventSourceFor((input) => {
      requested.push(new Request(input).url);
      return Promise.resolve(
        new Response("data: ok\n\n", {
          headers: { "content-type": "text/event-stream" },
        }),
      );
    });
    const source = new Source("https://host.invalid/events");
    await new Promise<void>((resolve) => {
      source.addEventListener("message", () => {
        resolve();
      });
    });
    source.close();
    expect(requested).toEqual(["https://host.invalid/events"]);
  });
});

function fakeSession(sessionId: string, failRead: boolean): ParakeetSession {
  return {
    latestPending: () => Promise.resolve(null),
    withdraw: () => Promise.resolve({ status: "unknown" }),
    address: sessionId,
    extension: noExtension,
    command: commandHandler(commandResult),
    read: () =>
      failRead
        ? Promise.reject(new Error("the read failed"))
        : Promise.resolve(sessionSnapshot()),
    watch: () => Promise.reject(new Error("no watch in this test")),
  };
}

function setup(failing: ReadonlySet<string>) {
  const services: OpeningServices<ParakeetSession> = {
    openAgent: () =>
      Promise.resolve({
        baseUrl: "https://agent.invalid",
        fetch: () => Promise.reject(new Error("no network in this test")),
        close: () => Promise.resolve(),
      }),
    createClient: () => ({
      session: (sessionId) => fakeSession(sessionId, failing.has(sessionId)),
      close: () => Promise.resolve(),
    }),
  };
  const events: string[] = [];
  let open: OpenConversation<ParakeetSession> | null = null;
  let error: string | null = null;
  let pending: PendingSelection | null = null;
  const owner = createConversationOpeningOwner({
    connection: {
      capabilities: createCapabilityRegistry(),
      ui: { reportAgentSessionSelection: () => Promise.resolve() },
    },
    queryClient: new QueryClient(),
    services,
    reportsSelection: false,
    onPending: (selection) => {
      pending = selection;
    },
    onConversation: (conversation) => {
      open = conversation;
      events.push(`open:${conversation?.sessionId ?? "none"}`);
    },
    onError: (message) => {
      error = message;
    },
  });
  return {
    owner,
    events,
    state: () => ({ open, error, pending }),
  };
}

describe("conversation opening owner", () => {
  it("keeps the previous conversation open, and says so, when the next Session's read fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const harness = setup(new Set(["broken"]));
    harness.owner.select("agent-1", "first");
    await vi.waitFor(() => {
      expect(harness.state().open?.sessionId).toBe("first");
    });

    harness.owner.select("agent-1", "broken");
    await vi.waitFor(() => {
      expect(harness.state().error).toContain(
        "The previous conversation remains open.",
      );
    });

    expect(harness.state().open?.sessionId).toBe("first");
    expect(harness.state().pending).toBeNull();
    expect(harness.events).toEqual(["open:first"]);
  });

  it("reports the failure and opens nothing when the first Session's read fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const harness = setup(new Set(["broken"]));
    harness.owner.select("agent-1", "broken");
    await vi.waitFor(() => {
      expect(harness.state().error).toContain("Try opening it again.");
    });
    expect(harness.state().open).toBeNull();
  });
});
