// @vitest-environment jsdom
import type {
  SessionCommand,
  SessionSnapshot,
} from "@fungi.computer/shiitake/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import { ParakeetProvider } from "../src/headless.js";
import { ParakeetView } from "../src/parakeet.js";
import type { ParakeetSession } from "../src/session.js";
import {
  commandHandler,
  commandResult,
  noExtension,
  queuedFacts,
  sessionSnapshot,
} from "./fixtures/session.fixture.js";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
  writable: true,
});

const roots = new Set<Root>();

afterEach(async () => {
  await act(async () => {
    for (const root of roots) root.unmount();
    await Promise.resolve();
  });
  roots.clear();
  document.body.replaceChildren();
});

const waitingSnapshot = (): SessionSnapshot =>
  sessionSnapshot({
    activity: queuedFacts("queued-1"),
  });

function render(
  snapshot: SessionSnapshot,
  commands: SessionCommand[],
): HTMLElement {
  const session: ParakeetSession = {
    latestPending: () => Promise.resolve(null),
    withdraw: () => Promise.resolve({ status: "unknown" }),
    address: `test://parakeet/waiting/${String(roots.size)}`,
    command: commandHandler(
      (input) => {
        commands.push(input);
        return commandResult(input);
      },
      (input) => {
        commands.push(input);
        return commandResult(input);
      },
      (input) => {
        commands.push(input);
        return commandResult(input);
      },
    ),
    extension: noExtension,
    read: () => Promise.resolve(snapshot),
    watch: () =>
      Promise.resolve({
        snapshot,
        changes: {
          [Symbol.asyncIterator]: () => ({
            next: () => new Promise(() => undefined),
            return: () => Promise.resolve({ done: true, value: undefined }),
          }),
        },
        close: () => Promise.resolve(),
      }),
  };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.add(root);
  act(() => {
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <ParakeetProvider session={session}>
          <ParakeetView />
        </ParakeetProvider>
      </QueryClientProvider>,
    );
  });
  return container;
}

async function settle(operation?: () => void): Promise<void> {
  await act(async () => {
    operation?.();
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  });
}

const waitingCopy = "Queued for host";
const cancelWaiting = (container: HTMLElement) =>
  container.querySelector<HTMLButtonElement>("[data-parakeet-waiting] button");

it("shows waiting work without offering to cancel its queue", async () => {
  const commands: SessionCommand[] = [];
  const container = render(waitingSnapshot(), commands);
  await vi.waitFor(async () => {
    await settle();
    expect(container.textContent).toContain(waitingCopy);
  });

  expect(cancelWaiting(container)).toBeNull();
  expect(commands).toEqual([]);
});

it("leaves queued work alone when the composer receives Esc", async () => {
  const commands: SessionCommand[] = [];
  const container = render(waitingSnapshot(), commands);
  await vi.waitFor(async () => {
    await settle();
    expect(container.textContent).toContain(waitingCopy);
  });

  await settle(() =>
    container.querySelector("textarea")?.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  expect(commands).toEqual([]);
});

it("shows no waiting notice for a Session that is running", async () => {
  const container = render(sessionSnapshot({ status: "thinking" }), []);
  await settle();
  await settle();
  expect(container.textContent).not.toContain(waitingCopy);
  expect(cancelWaiting(container)).toBeNull();
});

it("stops only the running command while three follow-ups stay queued", async () => {
  const commands: SessionCommand[] = [];
  const snapshot = sessionSnapshot({
    status: "thinking",
    pending: {
      total: ["First", "Second", "Third"].map((text, index) => ({
        requestId: "request-" + `queued-${String(index)}`,
        commandId: `queued-${String(index)}`,
        text,
        delivery: "followUp" as const,
      })).length,
      prompts: ["First", "Second", "Third"].map((text, index) => ({
        requestId: "request-" + `queued-${String(index)}`,
        commandId: `queued-${String(index)}`,
        text,
        delivery: "followUp" as const,
      })),
      hasMore: false,
    },
  });
  const container = render(snapshot, commands);
  await vi.waitFor(async () => {
    await settle();
    expect(
      container.querySelector('[data-testid="composer-stop"]'),
    ).not.toBeNull();
  });
  await settle(() =>
    container
      .querySelector<HTMLButtonElement>('[data-testid="composer-stop"]')
      ?.click(),
  );
  expect(commands).toEqual([{ type: "cancel", commandId: "running-command" }]);
  expect(container.querySelector("textarea")?.value).toBe("");
  expect(snapshot.pending.prompts.map(({ text }) => text)).toEqual([
    "First",
    "Second",
    "Third",
  ]);
});
