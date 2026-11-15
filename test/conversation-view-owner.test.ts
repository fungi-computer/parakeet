import { createCapabilityRegistry } from "@fungi.computer/agar";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import {
  createConversationView,
  type ConversationTarget,
} from "../src/conversation-view.js";
import type { OpeningServices } from "../src/conversation-opening.js";
import type { ParakeetSession } from "../src/headless.js";
import {
  commandHandler,
  commandResult,
  noExtension,
  sessionSnapshot,
} from "./fixtures/session.fixture.js";

const a: ConversationTarget = { agentId: "agent", sessionId: "a" };
const b: ConversationTarget = { agentId: "agent", sessionId: "b" };

function harness(options: {
  /** Hold a Session's prompt admission until released. */
  holdPrompt?: ReadonlySet<string>;
  navigate?: (target: ConversationTarget | null) => Promise<void>;
  shownRoute?: () => ConversationTarget | null;
}) {
  const closed: string[] = [];
  const releases = new Map<string, () => void>();
  const session = (sessionId: string): ParakeetSession => ({
    latestPending: () => Promise.resolve(null),
    withdraw: () => Promise.resolve({ status: "unknown" }),
    address: sessionId,
    extension: noExtension,
    command: commandHandler(async (input) => {
      if (options.holdPrompt?.has(sessionId))
        await new Promise<void>((resolve) => {
          releases.set(sessionId, resolve);
        });
      return commandResult(input);
    }),
    read: () => Promise.resolve(sessionSnapshot()),
    watch: () => Promise.reject(new Error("no watch in this test")),
  });
  const services: OpeningServices<ParakeetSession> = {
    openAgent: () =>
      Promise.resolve({
        baseUrl: "https://agent.invalid",
        fetch: () => Promise.reject(new Error("no network in this test")),
        close: () => Promise.resolve(),
      }),
    createClient: () => {
      let opened = "";
      return {
        session: (sessionId) => {
          opened = sessionId;
          return session(sessionId);
        },
        close: () => {
          closed.push(opened);
          return Promise.resolve();
        },
      };
    },
  };
  const view = createConversationView<ParakeetSession>({
    connection: {
      capabilities: createCapabilityRegistry(),
      ui: { reportAgentSessionSelection: () => Promise.resolve() },
    },
    queryClient: new QueryClient(),
    services,
    navigate: options.navigate,
    shownRoute: options.shownRoute,
  });
  const shown = () => {
    const state = view.snapshot().state.view;
    return state.kind === "open"
      ? state.conversation.sessionId
      : state.kind === "opening"
        ? `opening:${state.target.sessionId}`
        : "none";
  };
  return { view, closed, releases, shown };
}

describe("the conversation view owner", () => {
  it("a person's Session beats Grove's own first one, however they arrive", async () => {
    const { view, shown } = harness({});
    const auto = view.create("auto");
    expect(auto.accepted).toBe(true);
    // The person starts one too, before the automatic one has been created.
    const person = view.create("person");
    expect(person.accepted).toBe(true);
    // The automatic Session arrives late and is not shown.
    expect(view.created(auto.ticket ?? 0, a).accepted).toBe(false);
    expect(view.created(person.ticket ?? 0, b).accepted).toBe(true);
    await vi.waitFor(() => {
      expect(shown()).toBe("b");
    });
  });

  it("auto-open is refused once anything is in view", async () => {
    const { view, shown } = harness({});
    view.select(a);
    await vi.waitFor(() => {
      expect(shown()).toBe("a");
    });
    expect(view.create("auto").accepted).toBe(false);
  });

  it("never closes a conversation's client while a send is in flight", async () => {
    const { view, closed, releases, shown } = harness({
      holdPrompt: new Set(["a"]),
    });
    view.select(a);
    await vi.waitFor(() => {
      expect(shown()).toBe("a");
    });
    const open = view.snapshot().state.view;
    if (open.kind !== "open") throw new Error("a should be open");
    // A send on the conversation about to be left.
    const send = open.conversation.session.command({
      type: "prompt",
      requestId: "request-1",
      text: "hello",
      delivery: "steer",
    });
    view.select(b);
    await vi.waitFor(() => {
      expect(shown()).toBe("b");
    });
    // The view moved on, but the send is still in flight: a stays connected.
    await Promise.resolve();
    expect(closed).toEqual([]);
    releases.get("a")?.();
    await send;
    await vi.waitFor(() => {
      expect(closed).toEqual(["a"]);
    });
  });

  it("settles its route wait when the router never echoes", async () => {
    const navigate = vi.fn(() => Promise.resolve());
    const { view, shown } = harness({ navigate, shownRoute: () => a });
    view.observeRoute(null);
    view.select(a);
    await vi.waitFor(() => {
      expect(shown()).toBe("a");
    });
    expect(navigate).toHaveBeenCalledWith(a);
    // No route change was ever emitted for a, yet the wait is over: a later
    // route change (back to the list) is honoured.
    await vi.waitFor(() => {
      expect(view.snapshot().state.awaitingRoute).toBeUndefined();
    });
    view.observeRoute(null);
    expect(shown()).toBe("none");
  });
});
