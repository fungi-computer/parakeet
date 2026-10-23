import * as Schema from "effect/Schema";
import { defineClientEntry } from "@fungi.computer/shiitake/client-entry";
import { ExtensionId } from "@fungi.computer/shiitake/extensions";
import type { SessionFrame } from "@fungi.computer/shiitake/client";
import type { ParakeetSession } from "../../src/session.js";
import {
  commandHandler,
  commandResult,
  sessionSnapshot,
} from "./session.fixture.js";

const contract = {
  id: ExtensionId.make("inspection-fixture"),
  commands: {},
  projection: { schema: Schema.Struct({ title: Schema.String }) },
};
const rows = [
  { id: "first", title: "Trace the owner", tone: "settled" },
  { id: "second", title: "Wire the door", tone: "running" },
  { id: "third", title: "Test the boundary", tone: "muted" },
  { id: "fourth", title: "Capture the result", tone: "muted" },
  { id: "fifth", title: "Ship it", tone: "muted" },
] as const;
const client = defineClientEntry(contract, {
  contribute: () => ({
    chips: [],
    timeline: { cells: [], omitted: 0 },
    waiting: null,
    panel: [
      {
        id: "summary",
        title: "Wire the door",
        detail: "2/5",
        inspection: { commandId: "inspect", title: "Inspect", rows },
      },
    ],
  }),
});
/** Ordinary observed slots and an advertised Session command; no renderer-specific protocol. */
export function inspectionFixture() {
  const calls: string[] = [];
  const snapshot = sessionSnapshot({
    extensions: {
      [contract.id]: {
        status: "running",
        revision: "sha256:inspection",
        value: { title: "Wire the door" },
        catalog: {
          protocol: "whistle.catalog/v1",
          commands: [
            {
              id: "inspect",
              title: "Inspect",
              category: "Conversation",
              projections: { slash: { aliases: ["inspect"] } },
            },
          ],
        },
      },
    },
  });
  const session: ParakeetSession = {
    latestPending: () => Promise.resolve(null),
    withdraw: () => Promise.resolve({ status: "unknown" }),
    address: "inspection",
    command: commandHandler((input) => commandResult(input)),
    extension: () => ({
      call: (name) => {
        calls.push(name);
        return Promise.resolve({ type: "done" });
      },
    }),
    read: () => Promise.resolve(snapshot),
    watch: () =>
      Promise.resolve({
        snapshot,
        changes: {
          [Symbol.asyncIterator]() {
            return {
              next: () =>
                new Promise<IteratorResult<SessionFrame>>(() => undefined),
              return: () => Promise.resolve({ done: true, value: undefined }),
            };
          },
        },
        close: () => Promise.resolve(),
      }),
  };
  return { session, clients: [client], calls };
}
