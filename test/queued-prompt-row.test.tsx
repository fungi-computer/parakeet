import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import type {
  SessionFrame,
  SessionPendingPrompt,
} from "@fungi.computer/shiitake/client";
import { createWhistle } from "@fungi.computer/whistle";

import { Parakeet } from "../src/parakeet.js";
import type { ParakeetPromptResult, ParakeetSession } from "../src/session.js";
import {
  accepted,
  commandHandler,
  noExtension,
  sessionFrame,
  sessionSnapshot,
} from "./fixtures/session.fixture.js";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  value: true,
  configurable: true,
});
Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
  value: () => undefined,
  configurable: true,
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

/** A live change stream the test feeds one owner frame at a time. */
function frames() {
  const queued: SessionFrame[] = [];
  const waiting: ((result: IteratorResult<SessionFrame>) => void)[] = [];
  return {
    changes: {
      [Symbol.asyncIterator]: () => ({
        next: () => {
          const frame = queued.shift();
          if (frame !== undefined)
            return Promise.resolve({ done: false as const, value: frame });
          return new Promise<IteratorResult<SessionFrame>>((resolve) => {
            waiting.push(resolve);
          });
        },
        return: () =>
          Promise.resolve({ done: true as const, value: undefined }),
      }),
    },
    push: (frame: SessionFrame) => {
      const next = waiting.shift();
      if (next === undefined) queued.push(frame);
      else next({ done: false, value: frame });
    },
  };
}

/** The owner's view while the Agent is busy with other work. */
function busyUpdate(
  pending: readonly SessionPendingPrompt[],
  messages: Extract<SessionFrame, { kind: "update" }>["messages"] = [],
) {
  return sessionFrame({
    kind: "update",
    delivery: "live",
    cursor: `cursor-${String(pending.length)}-${String(messages.length)}`,
    messages,
    terminals: [],
    pending: { total: pending.length, prompts: pending, hasMore: false },
    status: "thinking",
  });
}

const settle = () =>
  act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });

it("announces owner state changes outside the transcript while the footer stays quiet", async () => {
  const live = frames();
  const snapshot = sessionSnapshot();
  const session: ParakeetSession = {
    address: "test://parakeet/quiet-footer",
    latestPending: () => Promise.resolve(null),
    withdraw: () => Promise.resolve({ status: "unknown" }),
    command: commandHandler(acceptedPrompt),
    extension: noExtension,
    read: () => Promise.resolve(snapshot),
    watch: () =>
      Promise.resolve({
        snapshot,
        changes: live.changes,
        close: () => Promise.resolve(),
      }),
  };
  function acceptedPrompt() {
    return Promise.resolve(accepted("unused"));
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const client = new QueryClient();
  try {
    act(() => {
      root.render(
        <QueryClientProvider client={client}>
          <Parakeet session={session} commands={createWhistle()} />
        </QueryClientProvider>,
      );
    });
    const announcement = () =>
      container.querySelector('[aria-live="polite"][aria-atomic="true"]');
    await vi.waitFor(() => {
      expect(announcement()?.textContent).toBe("idle");
    });
    const region = announcement();
    for (const status of [
      "streaming",
      "thinking",
      "idle",
    ] satisfies readonly import("./fixtures/session.fixture.js").FixtureStatus[]) {
      act(() => {
        live.push({
          kind: "reset",
          reason: "history_unavailable",
          cursor: null,
          baseline: sessionSnapshot({ status }),
        });
      });
      await vi.waitFor(() => {
        expect(announcement()?.textContent).toBe(
          status === "streaming" ? "writing" : status,
        );
      });
      expect(announcement()).toBe(region);
      expect(
        container.querySelector(".parakeet-composer-row")?.textContent,
      ).toBe("");
    }
  } finally {
    act(() => {
      root.unmount();
    });
    client.clear();
  }
});

it("keeps one dimmed row per prompt until the Agent takes it, then snaps it in place", async () => {
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(800);
  const live = frames();
  const admissions = new Map<string, (result: ParakeetPromptResult) => void>();
  const requestIds = new Map<string, string>();
  const session: ParakeetSession = {
    latestPending: () => Promise.resolve(null),
    withdraw: () => Promise.resolve({ status: "unknown" }),
    address: "test://parakeet/queued-prompt-row",
    read: () => Promise.resolve(sessionSnapshot({ status: "thinking" })),
    command: commandHandler((input) => {
      requestIds.set(input.text, input.requestId);
      return new Promise((resolve) => {
        admissions.set(input.text, resolve);
      });
    }),
    extension: noExtension,
    watch: () =>
      Promise.resolve({
        snapshot: sessionSnapshot({ status: "thinking" }),
        changes: live.changes,
        close: () => Promise.resolve(),
      }),
  };
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const queryClient = new QueryClient();
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <Parakeet session={session} commands={createWhistle()} />
      </QueryClientProvider>,
    );
    await Promise.resolve();
  });
  await settle();
  await settle();

  const textarea = host.querySelector("textarea");
  if (textarea === null) throw new Error("Parakeet composer missing");
  const setValue = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )?.set?.bind(textarea);
  if (setValue === undefined) throw new Error("Textarea setter missing");
  const send = async (text: string) => {
    await act(async () => {
      setValue(text);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
    });
    await act(async () => {
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
      await Promise.resolve();
    });
    await settle();
  };
  const rowOf = (text: string) => {
    const row = [
      ...host.querySelectorAll<HTMLElement>('[data-parakeet-entry="user"]'),
    ].find((candidate) => candidate.textContent.includes(text));
    if (row === undefined) throw new Error(`No row for ${text}`);
    return row;
  };
  const dimmed = (row: HTMLElement) =>
    row.querySelector('[data-speaker="user"]')?.getAttribute("data-pending") ===
    "true";
  // Every waiting state keeps the same element and announces its pending state.
  const expectWaiting = (first: HTMLElement, second: HTMLElement) => {
    expect(rowOf("First while busy")).toBe(first);
    expect(rowOf("Second while busy")).toBe(second);
    for (const row of [first, second]) {
      expect(dimmed(row)).toBe(true);
      expect(row.querySelector('[role="status"]')?.textContent).toBe("Sending");
    }
  };

  // Submitting: the optimistic rows.
  await send("First while busy");
  await send("Second while busy");
  const first = rowOf("First while busy");
  const second = rowOf("Second while busy");
  expectWaiting(first, second);

  // Admitted by the owner.
  await act(async () => {
    admissions.get("First while busy")?.(accepted("command-first"));
    admissions.get("Second while busy")?.(accepted("command-second"));
    await Promise.resolve();
  });
  await settle();
  expect(rowOf("First while busy")).toBe(first);
  expect(rowOf("Second while busy")).toBe(second);
  expect(dimmed(first)).toBe(false);
  expect(dimmed(second)).toBe(false);

  // Reported queued behind the running turn.
  const firstRequestId = requestIds.get("First while busy");
  const secondRequestId = requestIds.get("Second while busy");
  if (!firstRequestId || !secondRequestId) throw new Error("Requests missing");
  const queued: SessionPendingPrompt[] = [
    {
      requestId: firstRequestId,
      commandId: "command-first",
      text: "First while busy",
      delivery: "steer",
    },
    {
      requestId: secondRequestId,
      commandId: "command-second",
      text: "Second while busy",
      delivery: "steer",
    },
  ];
  await act(async () => {
    live.push(busyUpdate(queued));
    await Promise.resolve();
  });
  await settle();
  expectWaiting(first, second);

  // The Agent takes the first prompt: the same row turns full strength.
  await act(async () => {
    live.push(
      busyUpdate(queued.slice(1), [
        {
          id: "message-first",
          commandId: "command-first",
          requestId: firstRequestId,
          sequence: 1,
          value: { role: "user", content: "First while busy", timestamp: 1 },
        },
      ]),
    );
    await Promise.resolve();
  });
  await settle();
  expect(rowOf("First while busy")).toBe(first);
  expect(first.getAttribute("data-status")).toBe("confirmed");
  expect(dimmed(first)).toBe(false);
  expect(rowOf("Second while busy")).toBe(second);
  expect(dimmed(second)).toBe(true);
  expect(first.querySelector('[role="status"]')).toBeNull();
  expect(second.querySelector('[role="status"]')?.textContent).toBe("Sending");

  // A bounded reconnect can retain the owner's terminal without the older
  // message page. The accepted row must not remain an optimistic ghost.
  await act(async () => {
    live.push(
      sessionFrame({
        kind: "update",
        delivery: "live",
        cursor: "after-second-terminal",
        messages: [],
        terminals: [{ commandId: "command-second", outcome: "completed" }],
        pending: { total: 0, prompts: [], hasMore: false },
        status: "idle",
      }),
    );
    await Promise.resolve();
  });
  await settle();
  expect(
    [
      ...host.querySelectorAll<HTMLElement>('[data-parakeet-entry="user"]'),
    ].filter((row) => row.textContent.includes("Second while busy")),
  ).toHaveLength(0);
  expect(rowOf("First while busy")).toBe(first);

  await act(async () => {
    root.unmount();
    await Promise.resolve();
  });
  queryClient.clear();
});

it("keeps a failed prompt visible with its error affordance", async () => {
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(800);
  const live = frames();
  const session: ParakeetSession = {
    latestPending: () => Promise.resolve(null),
    withdraw: () => Promise.resolve({ status: "unknown" }),
    address: "test://parakeet/failed-prompt-row",
    read: () => Promise.resolve(sessionSnapshot({ status: "thinking" })),
    command: commandHandler(() =>
      Promise.reject(new Error("Owner unavailable")),
    ),
    extension: noExtension,
    watch: () =>
      Promise.resolve({
        snapshot: sessionSnapshot({ status: "thinking" }),
        changes: live.changes,
        close: () => Promise.resolve(),
      }),
  };
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const queryClient = new QueryClient();
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <Parakeet session={session} commands={createWhistle()} />
      </QueryClientProvider>,
    );
    await Promise.resolve();
  });
  await settle();
  await settle();
  const textarea = host.querySelector("textarea");
  if (textarea === null) throw new Error("Parakeet composer missing");
  const setValue = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )?.set?.bind(textarea);
  if (setValue === undefined) throw new Error("Textarea setter missing");
  await act(async () => {
    setValue("Lost on the way");
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    await Promise.resolve();
  });
  await act(async () => {
    textarea.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    await Promise.resolve();
  });
  await settle();
  const row = host.querySelector<HTMLElement>(
    '[data-parakeet-entry="user"][data-status="failed"]',
  );
  expect(row?.textContent).toContain("Lost on the way");
  expect(row?.querySelector('[role="alert"]')?.textContent).toContain(
    "Your prompt didn’t make it through.",
  );
  expect(
    row?.querySelector('button[aria-label="Dismiss failed prompt"]'),
  ).not.toBeNull();

  await act(async () => {
    root.unmount();
    await Promise.resolve();
  });
  queryClient.clear();
});
