import { createCapabilityRegistry } from "@fungi.computer/agar";
import { QueryClient } from "@tanstack/react-query";
import { setImmediate } from "node:timers/promises";
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

function setup(failing: ReadonlySet<string>, reportsSelection = false) {
  const openSession = vi.fn((sessionId: string) =>
    fakeSession(sessionId, failing.has(sessionId)),
  );
  const services: OpeningServices<ParakeetSession> = {
    openAgent: () =>
      Promise.resolve({
        baseUrl: "https://agent.invalid",
        fetch: () => Promise.reject(new Error("no network in this test")),
        close: () => Promise.resolve(),
      }),
    createClient: () => ({
      session: openSession,
      close: () => Promise.resolve(),
    }),
  };
  const events: string[] = [];
  let open: OpenConversation<ParakeetSession> | null = null;
  let error: string | null = null;
  let pending: PendingSelection | null = null;
  const reportAgentSessionSelection = vi.fn(
    (selection: PendingSelection | null) => {
      events.push(`report:${selection?.sessionId ?? "none"}`);
      return Promise.resolve();
    },
  );
  const owner = createConversationOpeningOwner({
    connection: {
      capabilities: createCapabilityRegistry(),
      ui: { reportAgentSessionSelection },
    },
    queryClient: new QueryClient(),
    services,
    reportsSelection,
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
    reportAgentSessionSelection,
    openSession,
    state: () => ({ open, error, pending }),
  };
}

describe("conversation opening owner", () => {
  it("does not report a replaced opening when its baseline arrives late", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let completeBaseline!: (
      snapshot: ReturnType<typeof sessionSnapshot>,
    ) => void;
    const baseline = new Promise<ReturnType<typeof sessionSnapshot>>(
      (resolve) => {
        completeBaseline = resolve;
      },
    );
    const harness = setup(new Set(), true);
    harness.openSession.mockReturnValueOnce({
      ...fakeSession("replaced", false),
      read: () => baseline,
    });
    try {
      harness.owner.select("agent-1", "replaced");
      await vi.waitFor(() => {
        expect(harness.openSession).toHaveBeenCalledWith("replaced");
      });
      harness.owner.select("agent-1", "current");
      await vi.waitFor(() => {
        expect(harness.state().open?.sessionId).toBe("current");
      });
      completeBaseline(sessionSnapshot());
      await setImmediate();
      expect(
        harness.reportAgentSessionSelection,
      ).toHaveBeenCalledExactlyOnceWith({
        agentId: "agent-1",
        sessionId: "current",
      });
    } finally {
      harness.owner.close();
      log.mockRestore();
    }
  });

  it.each([true, false])(
    "reports a ready conversation before publishing it only for the primary owner (%s)",
    async (reportsSelection) => {
      const harness = setup(new Set(), reportsSelection);
      try {
        harness.owner.select("agent-1", "created");
        await vi.waitFor(() => {
          expect(harness.state().open?.sessionId).toBe("created");
        });
        if (reportsSelection) {
          expect(
            harness.reportAgentSessionSelection,
          ).toHaveBeenCalledExactlyOnceWith({
            agentId: "agent-1",
            sessionId: "created",
          });
          expect(harness.events).toEqual(["report:created", "open:created"]);
        } else {
          expect(harness.reportAgentSessionSelection).not.toHaveBeenCalled();
          expect(harness.events).toEqual(["open:created"]);
        }
      } finally {
        harness.owner.close();
      }
    },
  );

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
