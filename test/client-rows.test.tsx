// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import * as Schema from "effect/Schema";
import { defineClientEntry } from "@fungi.computer/shiitake/client-entry";
import { ExtensionId } from "@fungi.computer/shiitake/extensions";
import type {
  SessionFrame,
  SessionExtensionSlots,
} from "@fungi.computer/shiitake/client";
import { Parakeet } from "../src/parakeet.js";
import type { ParakeetSession } from "../src/session.js";
import {
  commandHandler,
  commandResult,
  sessionFrame,
  sessionSnapshot,
} from "./fixtures/session.fixture.js";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});

it("renders generic placements, opens typed targets, dispatches actions and retires stopped rows", async () => {
  const entry = defineClientEntry(
    {
      id: ExtensionId.make("rows-proof"),
      commands: {},
      projection: { schema: Schema.String },
    },
    {
      contribute: (view) =>
        view.status !== "running" || view.value === null
          ? {
              chips: [],
              panel: [],
              timeline: { cells: [], omitted: 0 },
              waiting: null,
            }
          : {
              chips: [
                {
                  id: "state",
                  order: 0,
                  row: { id: "state", title: `Chip ${view.value}` },
                },
              ],
              panel: [
                {
                  id: "control",
                  title: `Panel ${view.value}`,
                  detail: "Owned detail",
                  open: {
                    params: [
                      { key: "agent", value: "other-agent" },
                      { key: "session", value: "other-session" },
                    ],
                  },
                  actions: [
                    {
                      id: "change",
                      label: "Change",
                      input: { text: view.value },
                    },
                  ],
                },
              ],
              timeline: {
                cells: [
                  {
                    id: "1",
                    sequence: 1,
                    at: 1,
                    commandId: null,
                    rows: [{ id: "event", title: "Committed event" }],
                  },
                ],
                omitted: 2,
              },
              waiting: null,
            },
    },
  );
  const slots = (value: string): SessionExtensionSlots => ({
    "rows-proof": {
      status: "running",
      revision: "sha256:fixture",
      value,
      catalog: {
        protocol: "whistle.catalog/v1",
        commands: [{ id: "change", title: "Change", category: "Probe" }],
      },
    },
  });
  const pending: SessionFrame[] = [];
  let deliver: ((value: IteratorResult<SessionFrame>) => void) | undefined;
  const changes: AsyncIterable<SessionFrame> = {
    [Symbol.asyncIterator]: () => ({
      next: () => {
        const value = pending.shift();
        return value === undefined
          ? new Promise((resolve) => {
              deliver = resolve;
            })
          : Promise.resolve({ done: false, value });
      },
      return: () => {
        deliver?.({ done: true, value: undefined });
        return Promise.resolve({ done: true, value: undefined });
      },
    }),
  };
  const push = (extensions: SessionExtensionSlots) => {
    const frame = sessionFrame({
      kind: "update",
      delivery: "live",
      cursor: null,
      messages: [],
      terminals: [],
      status: "idle",
      pending: { total: 0, prompts: [], hasMore: false },
      extensions,
    });
    if (deliver === undefined) pending.push(frame);
    else {
      const resolve = deliver;
      deliver = undefined;
      resolve({ done: false, value: frame });
    }
  };
  const snapshot = sessionSnapshot({ extensions: slots("first") });
  const call = vi.fn(() => Promise.resolve({ type: "done", result: null }));
  const close = vi.fn(() => Promise.resolve());
  const session: ParakeetSession = {
    latestPending: () => Promise.resolve(null),
    withdraw: () => Promise.resolve({ status: "unknown" }),
    address: "test://generic-browser-rows",
    command: commandHandler(commandResult),
    extension: () => ({ call }),
    read: () => Promise.resolve(snapshot),
    watch: () => Promise.resolve({ snapshot, changes, close }),
  };
  const opened = vi.fn();
  const query = new QueryClient();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const settle = async (operation?: () => void) =>
    act(async () => {
      operation?.();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
  try {
    await settle(() => {
      root.render(
        <QueryClientProvider client={query}>
          <Parakeet session={session} clients={[entry]} onOpen={opened} />
        </QueryClientProvider>,
      );
    });
    await settle();
    expect(container.textContent).toContain("Chip first");
    expect(container.textContent).toContain("Panel first");
    expect(container.textContent).toContain("Committed event");
    expect(container.textContent).toContain("2 earlier changes omitted");
    const controls = container.querySelector(
      '[aria-label="Session extension controls"]',
    );
    const button = (label: string) => {
      const found = [...(controls?.querySelectorAll("button") ?? [])].find(
        (value) => value.textContent === label,
      );
      if (found === undefined) throw new Error(`Missing control ${label}`);
      return found;
    };
    await settle(() => {
      button("Open").click();
    });
    expect(opened).toHaveBeenCalledWith({
      params: [
        { key: "agent", value: "other-agent" },
        { key: "session", value: "other-session" },
      ],
    });
    await settle(() => {
      button("Change").click();
    });
    expect(call).toHaveBeenCalledWith("change", { text: "first" });
    await settle(() => {
      push(slots("second"));
    });
    await vi.waitFor(async () => {
      await settle();
      expect(container.textContent).toContain("Panel second");
    });
    expect(container.textContent).not.toContain("Panel first");
    await settle(() => {
      push({
        "rows-proof": {
          status: "stopped",
          revision: "sha256:fixture",
          reason: "detached",
        },
      });
    });
    await vi.waitFor(async () => {
      await settle();
      expect(
        container.querySelector('[aria-label="Session extension controls"]'),
      ).toBeNull();
    });
    expect(container.textContent).not.toContain("Committed event");
  } finally {
    await settle(() => {
      root.unmount();
    });
    query.clear();
    container.remove();
  }
  expect(close).toHaveBeenCalledTimes(1);
});
