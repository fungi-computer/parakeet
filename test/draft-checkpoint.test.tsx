// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import {
  ParakeetProvider,
  createParakeetInteractions,
  useComposer,
  useStatus,
  type ComposerController,
  type ParakeetDraftStorage,
  type ParakeetDraftIdentity,
} from "../src/headless.js";
import type { ParakeetSession } from "../src/session.js";
import type { SessionFrame } from "@fungi.computer/shiitake/client";
import {
  createShiitakeClient,
  type WithdrawResult,
} from "@fungi.computer/shiitake/client";
import {
  commandHandler,
  noExtension,
  sessionSnapshot,
} from "./fixtures/session.fixture.js";

const roots = new Set<Root>();
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});
afterEach(() => {
  act(() => {
    for (const root of roots) root.unmount();
  });
  roots.clear();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  localStorage.clear();
});

function mount(
  storage?: ParakeetDraftStorage,
  options: Readonly<{
    address?: string;
    draftIdentity?: ParakeetDraftIdentity;
    outcome?: WithdrawResult;
  }> = {},
) {
  let current: ComposerController | undefined;
  let live = false;
  let sends = 0;
  const requests: string[] = [];
  const withdrawals: string[] = [];
  const interactions = createParakeetInteractions();
  const session: ParakeetSession = {
    address: options.address ?? "test://checkpoint",
    command: commandHandler((input) => {
      sends += 1;
      requests.push(input.requestId);
      return new Promise(() => undefined);
    }),
    latestPending: () => Promise.resolve(null),
    withdraw: (requestId) => {
      withdrawals.push(requestId);
      return Promise.resolve(options.outcome ?? { status: "unknown" });
    },
    extension: noExtension,
    read: () => Promise.resolve(sessionSnapshot()),
    watch: () =>
      Promise.resolve({
        snapshot: sessionSnapshot(),
        changes: {
          [Symbol.asyncIterator]: () => ({
            next: () =>
              new Promise<IteratorResult<SessionFrame>>(() => undefined),
          }),
        },
        close: () => Promise.resolve(),
      }),
  };
  function Probe() {
    current = useComposer();
    live = useStatus().observation.status === "live";
    return null;
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.add(root);
  act(() => {
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <ParakeetProvider
          session={session}
          draftStorage={storage}
          interactionStore={interactions}
          draftIdentity={options.draftIdentity}
        >
          <Probe />
        </ParakeetProvider>
      </QueryClientProvider>,
    );
  });
  return {
    async ready() {
      await vi.waitFor(async () => {
        await act(async () => {
          await new Promise<void>((resolve) => {
            setTimeout(resolve, 0);
          });
        });
        expect(live).toBe(true);
      });
    },
    composer() {
      if (current === undefined) throw new Error("Composer unavailable");
      return current;
    },
    sends: () => sends,
    interactions,
    requests,
    withdrawals,
    close() {
      act(() => {
        root.unmount();
      });
      roots.delete(root);
    },
  };
}

it("drops disposable journals from the superseded storage key", async () => {
  localStorage.setItem(
    "fungi.parakeet.drafts.v1:test://checkpoint",
    JSON.stringify({ draft: "Disposable old draft", pending: [] }),
  );
  const view = mount();
  await view.ready();
  expect(view.composer().draft).toBe("");
  act(() => {
    view.composer().setDraft("Current draft");
  });
  expect(
    localStorage.getItem("fungi.parakeet.drafts.v2:test://checkpoint"),
  ).toContain("Current draft");
});

it.each([
  "{invalid JSON",
  JSON.stringify({ draft: "Invalid journal shape", pending: "not an array" }),
])(
  "keeps the conversation usable with a malformed saved journal: %s",
  async (saved) => {
    const key = "fungi.parakeet.drafts.v2:test://checkpoint";
    localStorage.setItem(key, saved);
    const view = mount();
    await view.ready();
    expect(view.composer().draft).toBe("");
    expect(view.sends()).toBe(0);
    act(() => {
      view.composer().setDraft("A fresh usable draft");
    });
    expect(localStorage.getItem(key)).toContain("A fresh usable draft");
  },
);

it("keeps the conversation usable when reading its draft storage throws", async () => {
  const storage: ParakeetDraftStorage = {
    getItem() {
      throw new DOMException("Storage denied for this origin", "SecurityError");
    },
    setItem(key, value) {
      localStorage.setItem(key, value);
    },
  };
  const view = mount(storage);
  await view.ready();
  expect(view.composer().draft).toBe("");
  expect(view.sends()).toBe(0);
  act(() => {
    view.composer().setDraft("A fresh usable draft");
  });
  expect(
    localStorage.getItem("fungi.parakeet.drafts.v2:test://checkpoint"),
  ).toContain("A fresh usable draft");
});

it("keeps a sandboxed conversation usable when acquiring browser storage throws SecurityError", async () => {
  vi.spyOn(globalThis, "localStorage", "get").mockImplementation(() => {
    throw new DOMException("Storage denied for this origin", "SecurityError");
  });
  const first = mount();
  await first.ready();
  expect(first.interactions.snapshot().notice).toEqual({
    tone: "info",
    message:
      "Drafts are session-only because browser storage is unavailable. They will be lost when this conversation closes.",
  });
  act(() => {
    first.composer().setDraft("A session-only draft");
  });
  expect(first.composer().draft).toBe("A session-only draft");
  expect(first.composer().checkpointDraft()).toEqual({
    status: "failed",
    reason: "Durable draft storage is unavailable",
  });
  await act(async () => {
    first.composer().send();
    await Promise.resolve();
  });
  expect(first.sends()).toBe(1);
  act(() => {
    first.composer().setDraft("An unsent draft that cannot survive closing");
  });
  expect(first.composer().draft).toBe(
    "An unsent draft that cannot survive closing",
  );
  first.close();
  expect(mount().composer().draft).toBe("");
});

it("uses a supplied durable adapter without reading the sandboxed browser storage getter", () => {
  const storage = localStorage;
  const getter = vi
    .spyOn(globalThis, "localStorage", "get")
    .mockImplementation(() => {
      throw new DOMException("Storage denied for this origin", "SecurityError");
    });
  const first = mount(storage);
  act(() => {
    first.composer().setDraft("A durable adapter draft");
  });
  expect(first.composer().checkpointDraft()).toEqual({ status: "saved" });
  expect(first.interactions.snapshot().notice).toBeUndefined();
  first.close();
  expect(mount(storage).composer().draft).toBe("A durable adapter draft");
  expect(getter).not.toHaveBeenCalled();
});

it("checkpoints the latest revision through an older callback and restores newer typing without sending", () => {
  const first = mount();
  const captureAtRestart = first.composer().checkpointDraft;
  act(() => {
    first.composer().setDraft("Earlier text");
  });
  const captured = "  Latest text\nwith exact whitespace  ";
  act(() => {
    first.composer().setDraft(captured);
  });
  expect(captureAtRestart()).toEqual({ status: "saved" });
  expect(first.composer().draft).toBe(captured);
  const newer = `${captured}\nand still newer typing`;
  act(() => {
    first.composer().setDraft(newer);
  });
  first.close();
  const resumed = mount();
  expect(resumed.composer().draft).toBe(newer);
  expect(captureAtRestart()).toEqual({
    status: "failed",
    reason: "Conversation is no longer mounted",
  });
  expect(resumed.composer().draft).toBe(newer);
  expect(resumed.sends()).toBe(0);
});

const identity: ParakeetDraftIdentity = {
  agentId: "durable-agent",
  sessionId: "durable-session",
};
// The same public producer as Local: version replacement changes both port and
// serviceId, but neither belongs to the durable owner pair.
const oldAddress = createShiitakeClient({
  baseUrl: "http://127.0.0.1:40123/service/old/agents/durable-agent",
}).session(identity.sessionId).address;
const replacementAddress = createShiitakeClient({
  baseUrl: "http://127.0.0.1:40124/service/replacement/agents/durable-agent",
}).session(identity.sessionId).address;

it.each([false, true])(
  "does not resurrect a consumed command on remount (consume on dispatch: %s)",
  async (consumeOnDispatch) => {
    const first = mount(localStorage, {
      address: oldAddress,
      draftIdentity: identity,
    });
    act(() => {
      first.composer().setDraft("/test consumed");
    });
    await act(async () => {
      await first.composer().submitCommand((_draft, consume) => {
        if (consumeOnDispatch) consume();
        return Promise.resolve({ status: "handled" });
      });
    });
    expect(first.composer().draft).toBe("");
    first.close();
    const resumed = mount(localStorage, {
      address: replacementAddress,
      draftIdentity: identity,
    });
    expect(resumed.composer().draft).toBe("");
    expect(resumed.sends()).toBe(0);
  },
);

it.each(["Newer typing", "/test original"])(
  "never clears a newer draft revision when the old command finishes: %s",
  async (newer) => {
    const first = mount();
    act(() => {
      first.composer().setDraft("/test original");
    });
    let complete: (() => void) | undefined;
    const running = first.composer().submitCommand(
      () =>
        new Promise((resolve) => {
          complete = () => {
            resolve({ status: "handled" });
          };
        }),
    );
    act(() => {
      first.composer().setDraft("Intermediate newer revision");
      first.composer().setDraft(newer);
    });
    if (complete === undefined) throw new Error("Command was not dispatched");
    const finish = complete;
    await act(async () => {
      finish();
      await running;
    });
    expect(first.composer().draft).toBe(newer);
    first.close();
    expect(mount().composer().draft).toBe(newer);
  },
);

it("refuses command consumption if the existing journal cannot commit, preserving the live and durable draft", async () => {
  let refuseWrites = false;
  const storage: ParakeetDraftStorage = {
    getItem: (key) => localStorage.getItem(key),
    setItem: (key, value) => {
      if (refuseWrites) throw new Error("Disk is full");
      localStorage.setItem(key, value);
    },
  };
  const first = mount(storage);
  act(() => {
    first.composer().setDraft("/test keep");
  });
  refuseWrites = true;
  let dispatched = false;
  await act(async () => {
    await expect(
      first.composer().submitCommand((_draft, consume) => {
        consume();
        dispatched = true;
        return Promise.resolve({ status: "handled" });
      }),
    ).rejects.toThrow("Disk is full");
  });
  expect(dispatched).toBe(false);
  expect(first.composer().draft).toBe("/test keep");
  first.close();
  refuseWrites = false;
  expect(mount(storage).composer().draft).toBe("/test keep");
});

it.each([false, true])(
  "preserves the declared consume decision when a command fails (consumed: %s)",
  async (consumed) => {
    const first = mount();
    act(() => {
      first.composer().setDraft("/test fails");
    });
    await act(async () => {
      await first.composer().submitCommand((_draft, consume) => {
        if (consumed) consume();
        return Promise.resolve({
          status: "failed",
          error: { code: "handler_failed", message: "Command failed" },
        });
      });
    });
    const expected = consumed ? "" : "/test fails";
    expect(first.composer().draft).toBe(expected);
    first.close();
    expect(mount().composer().draft).toBe(expected);
  },
);

it("restores the owner-scoped draft across changed service addresses and isolates other Sessions and Agents", () => {
  expect(replacementAddress).not.toBe(oldAddress);
  const first = mount(localStorage, {
    address: oldAddress,
    draftIdentity: identity,
  });
  const text = "  Exact draft\nacross service replacement  ";
  act(() => {
    first.composer().setDraft(text);
  });
  expect(first.composer().checkpointDraft()).toEqual({ status: "saved" });
  first.close();
  const resumed = mount(localStorage, {
    address: replacementAddress,
    draftIdentity: identity,
  });
  expect(resumed.composer().draft).toBe(text);
  expect(resumed.sends()).toBe(0);
  for (const other of [
    { ...identity, sessionId: "different-session" },
    { ...identity, agentId: "different-agent" },
  ]) {
    const isolated = mount(localStorage, {
      address: createShiitakeClient({
        baseUrl: `http://127.0.0.1:40124/service/replacement/agents/${other.agentId}`,
      }).session(other.sessionId).address,
      draftIdentity: other,
    });
    expect(isolated.composer().draft).toBe("");
    expect(isolated.sends()).toBe(0);
    isolated.close();
  }
  expect(resumed.composer().draft).toBe(text);
  expect(localStorage.length).toBe(1);
});

const outcomes: WithdrawResult[] = [
  { status: "accepted", commandId: "already-admitted" },
  { status: "unknown" },
];
it.each(outcomes)(
  "reconciles $status pending identity through the replacement transport without resending",
  async (outcome) => {
    const first = mount(localStorage, {
      address: oldAddress,
      draftIdentity: identity,
    });
    await first.ready();
    const submitted = "  Pending first line\nand exact second line  ";
    act(() => {
      first.composer().setDraft(submitted);
    });
    act(() => {
      first.composer().send();
    });
    act(() => {
      first.composer().setDraft("Newer unsent text");
    });
    expect(first.composer().checkpointDraft()).toEqual({ status: "saved" });
    first.close();
    const resumed = mount(localStorage, {
      address: replacementAddress,
      draftIdentity: identity,
      outcome,
    });
    await vi.waitFor(async () => {
      await act(async () => {
        await Promise.resolve();
      });
      expect(resumed.withdrawals).toEqual(first.requests);
      expect(resumed.composer().draft).toBe(
        outcome.status === "accepted"
          ? "Newer unsent text"
          : `Newer unsent text\n\n${submitted}`,
      );
    });
    expect(resumed.withdrawals).toEqual(first.requests);
    expect(resumed.withdrawals).toHaveLength(1);
    expect(resumed.sends()).toBe(0);
    expect(resumed.composer().draft).toBe(
      outcome.status === "accepted"
        ? "Newer unsent text"
        : `Newer unsent text\n\n${submitted}`,
    );
    expect(localStorage.length).toBe(1);
  },
);

it("failed checkpoint leaves the live draft and existing durable journal untouched", () => {
  let refuseWrites = false;
  const storage: ParakeetDraftStorage = {
    getItem: (key) => localStorage.getItem(key),
    setItem: (key, value) => {
      if (refuseWrites) throw new Error("Disk is full");
      localStorage.setItem(key, value);
    },
  };
  const view = mount(storage);
  const original = "  Keep this draft\nexactly  ";
  act(() => {
    view.composer().setDraft(original);
  });
  const before = localStorage.getItem(
    "fungi.parakeet.drafts.v2:test://checkpoint",
  );
  refuseWrites = true;
  expect(view.composer().checkpointDraft()).toEqual({
    status: "failed",
    reason: "Disk is full",
  });
  expect(view.composer().draft).toBe(original);
  expect(
    localStorage.getItem("fungi.parakeet.drafts.v2:test://checkpoint"),
  ).toBe(before);
  expect(view.sends()).toBe(0);
});

it("checkpoints pending admission identities without resending or restoring them into the draft", async () => {
  const view = mount();
  await view.ready();
  const submitted = "  Pending exact text  ";
  act(() => {
    view.composer().setDraft(submitted);
  });
  act(() => {
    view.composer().send();
  });
  act(() => {
    view.composer().setDraft("Unsubmitted newer text");
  });
  const before = localStorage.getItem(
    "fungi.parakeet.drafts.v2:test://checkpoint",
  );
  expect(view.composer().checkpointDraft()).toEqual({ status: "saved" });
  expect(
    localStorage.getItem("fungi.parakeet.drafts.v2:test://checkpoint"),
  ).toBe(before);
  expect(view.composer().draft).toBe("Unsubmitted newer text");
  expect(view.sends()).toBe(1);
  expect(before).toContain(submitted);
});
