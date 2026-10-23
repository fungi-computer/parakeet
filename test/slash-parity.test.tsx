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
function gardenSession(call = gardenCall): ParakeetSession {
  const snapshot = sessionSnapshot({ extensions: gardenSlots() });
  return {
    latestPending: () => Promise.resolve(null),
    withdraw: () => Promise.resolve({ status: "unknown" }),
    address: "test://parakeet/garden",
    command: commandHandler(commandResult),
    extension: () => ({ call }),
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

function deferred<Value>() {
  let complete: ((value: Value) => void) | undefined;
  let fail: ((error: Error) => void) | undefined;
  const promise = new Promise<Value>((resolve, reject) => {
    complete = resolve;
    fail = reject;
  });
  return {
    promise,
    resolve(value: Value) {
      if (complete === undefined)
        throw new Error("Reply gate was not initialized");
      complete(value);
    },
    reject(error: Error) {
      if (fail === undefined) throw new Error("Reply gate was not initialized");
      fail(error);
    },
  };
}

function renderGarden(session = gardenSession()) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.add(root);
  act(() => {
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <ParakeetProvider session={session}>
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
  const guidanceId = `${input.id}-guidance`;
  expect(input.getAttribute("aria-describedby")).toContain(guidanceId);
  const guidance = document.getElementById(guidanceId);
  expect(guidance?.textContent).toBe(
    "↑↓ choose · Tab complete · Enter run · Esc dismiss",
  );
  expect(guidance?.className).toBe("sr-only");
  expect(guidance?.hasAttribute("aria-live")).toBe(false);
  expect(container.querySelector(".parakeet-key-hints")).toBeNull();
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
    expect(document.querySelector("[role=dialog]")).toBeNull();
  });
  expect(document.body.textContent).not.toContain(slashParityFlow.notice);
  expect(input.value).toBe("");
});

it("Try again repeats only the failed catalog step with the same inputs", async () => {
  const calls: Parameters<typeof gardenCall>[] = [];
  const session = gardenSession((command, args) => {
    calls.push([command, args]);
    if (calls.length === 2)
      return Promise.reject(new Error("The watering service is unavailable."));
    return gardenCall(command, args);
  });
  const { input } = renderGarden(session);
  await vi.waitFor(async () => {
    await settle(() => {
      type(input, "/water");
    });
    expect(rows(document.body)).toEqual(["/water"]);
  });
  await settle(() => {
    key(input, "Enter");
  });
  await vi.waitFor(async () => {
    await settle();
    expect(document.body.textContent).toContain("Which bed?");
  });
  const fern = [...document.body.querySelectorAll("[role=option]")].find(
    (node) => node.textContent === "Fern bed",
  );
  if (!(fern instanceof HTMLElement)) throw new Error("No fern option");
  await settle(() => {
    fern.click();
  });
  await vi.waitFor(async () => {
    await settle();
    expect(document.body.textContent).toContain(
      "The watering service is unavailable.",
    );
  });
  await settle(() => {
    type(input, "A newer unsent draft");
  });
  const retry = [...document.body.querySelectorAll("button")].find(
    (node) => node.textContent === "Try again",
  );
  if (!(retry instanceof HTMLButtonElement)) throw new Error("No Retry");
  await settle(() => {
    retry.click();
  });
  expect(calls).toHaveLength(3);
  expect(calls[2]).toEqual(calls[1]);
  expect(input.value).toBe("A newer unsent draft");
  expect(document.body.textContent).not.toContain("Which bed?");
});

it("reuses the normal running row and keeps the retried result until Done", async () => {
  const first = deferred<Awaited<ReturnType<typeof gardenCall>>>();
  const retried = deferred<Awaited<ReturnType<typeof gardenCall>>>();
  const calls: Parameters<typeof gardenCall>[] = [];
  const { input } = renderGarden(
    gardenSession((command, args) => {
      calls.push([command, args]);
      if (calls.length === 2) return first.promise;
      if (calls.length === 3) return retried.promise;
      return gardenCall(command, args);
    }),
  );
  const row = () =>
    document.querySelector('section[aria-label="Water a garden bed"] > p');
  try {
    await vi.waitFor(async () => {
      await settle(() => {
        type(input, "/water");
      });
      expect(rows(document.body)).toEqual(["/water"]);
    });
    await settle(() => {
      key(input, "Enter");
    });
    await vi.waitFor(async () => {
      await settle();
      expect(document.body.textContent).toContain("Which bed?");
    });
    const fern = [...document.body.querySelectorAll("[role=option]")].find(
      (node) => node.textContent === "Fern bed",
    );
    if (!(fern instanceof HTMLElement)) throw new Error("No Fern option");
    await settle(() => {
      fern.click();
    });
    expect(row()?.textContent).toBe("Water a garden bed");
    expect(
      row()?.querySelector(".caps-status")?.getAttribute("data-motion"),
    ).toBe("pulse");
    await settle(() => {
      first.reject(new Error("Watering unavailable"));
    });
    await vi.waitFor(async () => {
      await settle();
      expect(document.body.textContent).toContain("Watering unavailable");
    });
    await settle(() => {
      type(input, "Newer draft");
    });
    const retry = [...document.body.querySelectorAll("button")].find(
      (node) => node.textContent === "Try again",
    );
    if (!(retry instanceof HTMLButtonElement)) throw new Error("No Retry");
    await settle(() => {
      retry.click();
    });
    const runningRow = row();
    expect(runningRow?.textContent).toBe("Water a garden bed");
    expect(
      runningRow?.querySelector(".caps-status")?.getAttribute("data-motion"),
    ).toBe("pulse");
    await settle(() => {
      retried.resolve({
        type: "done",
        notice: { type: "success", message: "Watered the fern bed." },
      });
    });
    await vi.waitFor(async () => {
      await settle();
      expect(row()?.textContent).toBe("Watered the fern bed.");
    });
    expect(row()).toBe(runningRow);
    expect(
      row()?.querySelector(".caps-status")?.getAttribute("data-motion"),
    ).toBe("none");
    expect(calls).toHaveLength(3);
    expect(calls[2]).toEqual(calls[1]);
    expect(input.value).toBe("Newer draft");
    const done = [...document.body.querySelectorAll("button")].find(
      (node) => node.textContent === "Done",
    );
    if (!(done instanceof HTMLButtonElement)) throw new Error("No Done");
    await settle(() => {
      done.click();
    });
    expect(row()).toBeNull();
    expect(input.value).toBe("Newer draft");
  } finally {
    await settle(() => {
      first.resolve({ type: "done" });
      retried.resolve({ type: "done" });
    });
  }
});
