// @vitest-environment jsdom
import { createWhistle } from "@fungi.computer/whistle";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import { ParakeetProvider } from "../src/headless.js";
import { ParakeetView } from "../src/parakeet.js";
import type { ParakeetSession } from "../src/session.js";
import {
  gardenCall,
  gardenSlots,
  slashParityCases,
  slashParityFlow,
} from "@fungi.computer/parakeet-testing";
import {
  commandHandler,
  commandResult,
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

/** A Session whose only extension is one this client has never heard of. */
function gardenSession(): ParakeetSession {
  const snapshot = sessionSnapshot({ extensions: gardenSlots() });
  return {
    address: "test://parakeet/garden",
    command: commandHandler(commandResult),
    extension: () => ({ call: gardenCall }),
    read: () => Promise.resolve(snapshot),
    watch: () =>
      Promise.resolve({
        snapshot,
        changes: {
          [Symbol.asyncIterator]: () => ({
            next: () => new Promise<never>(() => undefined),
          }),
        },
        close: () => Promise.resolve(),
      }),
  };
}

async function settle(operation?: () => void): Promise<void> {
  await act(async () => {
    operation?.();
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  });
}

function renderGarden() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.add(root);
  act(() => {
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <ParakeetProvider session={gardenSession()}>
          <ParakeetView commands={createWhistle()} />
        </ParakeetProvider>
      </QueryClientProvider>,
    );
  });
  const input = container.querySelector("textarea");
  if (!(input instanceof HTMLTextAreaElement))
    throw new Error("Composer textarea is unavailable");
  return { container, input };
}

function type(element: HTMLTextAreaElement, value: string): void {
  Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )?.set?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

function key(element: HTMLTextAreaElement, name: string): void {
  element.dispatchEvent(
    new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: name,
    }),
  );
}

function rows(container: HTMLElement): string[] {
  return [
    ...container.querySelectorAll(
      "[data-parakeet-slash] [role=option] .parakeet-slash-label",
    ),
  ].map((row) => row.textContent);
}

it("draws exactly Parakeet's completion rows for every parity case", async () => {
  const { container, input } = renderGarden();
  await vi.waitFor(async () => {
    await settle(() => {
      type(input, "/w");
    });
    expect(rows(container)).toEqual(["/water"]);
  });
  for (const { draft, rows: expected } of slashParityCases) {
    await settle(() => {
      type(input, draft);
    });
    expect(rows(container), draft).toEqual(expected);
  }
  await settle(() => {
    type(input, "/water ");
  });
  expect(container.querySelector(".parakeet-slash-hint")?.textContent).toBe(
    "/water <bed> | all",
  );
  expect(container.querySelector(".parakeet-key-hints")?.textContent).toBe(
    "↑↓ choose · Tab complete · Enter run · Esc dismiss",
  );
});

it("completes with Tab, dismisses with Escape and runs an advertised flow", async () => {
  const { container, input } = renderGarden();
  await vi.waitFor(async () => {
    await settle(() => {
      type(input, "/wa");
    });
    expect(rows(container)).toEqual(["/water"]);
  });
  await settle(() => {
    key(input, "Tab");
  });
  expect(input.value).toBe("/water ");
  await settle(() => {
    key(input, "Escape");
  });
  expect(rows(container)).toEqual([]);

  await settle(() => {
    type(input, slashParityFlow.draft);
  });
  await settle(() => {
    key(input, "Enter");
  });
  await vi.waitFor(async () => {
    await settle();
    expect(document.body.textContent).toContain(slashParityFlow.prompt);
  });
  const option = [...document.body.querySelectorAll("[role=option]")].find(
    (candidate) => candidate.textContent === slashParityFlow.choose,
  );
  if (!(option instanceof HTMLElement)) throw new Error("No fern option");
  await settle(() => {
    option.click();
  });
  await vi.waitFor(async () => {
    await settle();
    expect(document.body.textContent).toContain(slashParityFlow.notice);
  });
  expect(input.value).toBe("");
});
