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

const statusWords = /Sending|Queued|Prompt accepted/u;

it("keeps one dimmed row per prompt until the Agent takes it, then snaps it in place", async () => {
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(800);
  const live = frames();
  const admissions = new Map<string, (result: ParakeetPromptResult) => void>();
  const session: ParakeetSession = {
    address: "test://parakeet/queued-prompt-row",
    read: () => Promise.resolve(sessionSnapshot({ status: "thinking" })),
    command: commandHandler(
      (input) =>
        new Promise((resolve) => {
          admissions.set(input.text, resolve);
        }),
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
  // Every intermediate state shows the same element, dimmed, with no sub-line.
  const expectWaiting = (first: HTMLElement, second: HTMLElement) => {
    expect(rowOf("First while busy")).toBe(first);
    expect(rowOf("Second while busy")).toBe(second);
    for (const row of [first, second]) {
      expect(dimmed(row)).toBe(true);
      expect(row.textContent).not.toMatch(statusWords);
      expect(row.querySelector('[role="status"]')).toBeNull();
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
  expectWaiting(first, second);

  // Reported queued behind the running turn.
  const queued: SessionPendingPrompt[] = [
    { commandId: "command-first", text: "First while busy", delivery: "steer" },
    {
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
  expect(host.textContent).not.toMatch(statusWords);

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
