// @vitest-environment jsdom
// An extension's retained-event notice and null-anchor rows join its own
// footer entry; one with no panel row keeps none of this, rather than
// growing a section -- or the old separate "Extension changes" one -- just
// to show it.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it } from "vitest";
import * as Schema from "effect/Schema";
import { defineClientEntry } from "@fungi.computer/shiitake/client-entry";
import { ExtensionId } from "@fungi.computer/shiitake/extensions";
import type { SessionExtensionSlots } from "@fungi.computer/shiitake/client";
import { Parakeet } from "../src/parakeet.js";
import type { ParakeetSession } from "../src/session.js";
import {
  commandHandler,
  commandResult,
  sessionSnapshot,
} from "./fixtures/session.fixture.js";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});

it("drops a footerless extension's omitted notice and unanchored rows entirely", async () => {
  const entry = defineClientEntry(
    {
      id: ExtensionId.make("silent-footer"),
      commands: {},
      projection: { schema: Schema.String },
    },
    {
      // No panel, no chips: this extension has no footer slot at all.
      contribute: () => ({
        chips: [],
        panel: [],
        timeline: {
          cells: [
            {
              id: "1",
              sequence: 1,
              at: 1,
              commandId: null,
              rows: [{ id: "orphan", title: "Orphan committed row" }],
            },
          ],
          omitted: 5,
        },
        waiting: null,
      }),
    },
  );
  const slots: SessionExtensionSlots = {
    "silent-footer": {
      status: "running",
      revision: "sha256:fixture",
      value: "ready",
    },
  };
  const snapshot = sessionSnapshot({ extensions: slots });
  const session: ParakeetSession = {
    address: "test://footerless-browser-rows",
    command: commandHandler(commandResult),
    extension: () => ({
      call: () => Promise.resolve({ type: "done", result: null }),
    }),
    read: () => Promise.resolve(snapshot),
    watch: () =>
      Promise.resolve({
        snapshot,
        changes: {
          [Symbol.asyncIterator]: () => ({
            next: () => new Promise(() => undefined),
          }),
        },
        close: () => Promise.resolve(),
      }),
  };
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
          <Parakeet session={session} clients={[entry]} />
        </QueryClientProvider>,
      );
    });
    await settle();
    expect(container.textContent).not.toContain("earlier changes omitted");
    expect(container.textContent).not.toContain("Orphan committed row");
    expect(container.textContent).not.toContain("Extension changes");
    expect(
      container.querySelector('[aria-label="Session extension controls"]'),
    ).toBeNull();
  } finally {
    await settle(() => {
      root.unmount();
    });
    container.remove();
  }
});
