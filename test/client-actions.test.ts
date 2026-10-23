import * as Redacted from "effect/Redacted";
import {
  createWhistle,
  type WhistleRuntime,
  type WhistleExecutionOutcome,
} from "@fungi.computer/whistle";
import { catalogCommands, parseCatalog } from "@fungi.computer/whistle/catalog";
import type { ClientContributionV1 } from "@fungi.computer/shiitake/client-entry";
import { expect, it, vi } from "vitest";
import { createParakeetInteractions } from "../src/commands/interactions.js";
import { createClientActions } from "../src/core/client-actions.js";
import type { ClientContribution } from "../src/core/client-contributions.js";

function fixture(
  invoke: Parameters<typeof catalogCommands>[1],
  execution?: Pick<WhistleRuntime, "execute">,
) {
  const action: NonNullable<ClientContributionV1["waiting"]>["cancel"] = {
    id: "stop",
    label: "Stop timer",
    input: { reason: "human" },
  };
  let contributions: readonly ClientContribution[] = [
    {
      entryId: "probe",
      value: {
        chips: [],
        panel: [],
        timeline: { cells: [], omitted: 0 },
        waiting: { summary: "Timer waiting", cancel: action },
      },
    },
  ];
  let online = true;
  const commands = createWhistle();
  const catalog = parseCatalog({
    protocol: "whistle.catalog/v1",
    commands: [
      {
        id: "stop",
        title: "Stop timer",
        category: "Probe",
        projections: { menu: {} },
      },
    ],
  });
  commands.contribute({
    sourceId: "extension:probe",
    namespace: "probe",
    commands: catalogCommands(catalog, invoke),
  });
  const interactions = createParakeetInteractions();
  interactions.attach(commands.present);
  const actions = createClientActions({
    commands: execution ?? commands,
    interactions,
    contributions: () => contributions,
    online: () => online,
  });
  return {
    action,
    actions,
    interactions,
    retire: () => {
      contributions = [];
    },
    reproject: () => {
      const refreshed = { ...action, label: "Stop refreshed timer" };
      contributions = contributions.map((entry) => ({
        ...entry,
        value: {
          ...entry.value,
          waiting: { summary: "Timer still waiting", cancel: refreshed },
        },
      }));
      actions.refresh();
      return refreshed;
    },
    disconnect: () => {
      online = false;
    },
  };
}

it("waiting cancellation toasts an advertised info notice and never echoes a success", async () => {
  const toasts: unknown[] = [];
  const info = fixture(() =>
    Promise.resolve({
      type: "done",
      notice: { type: "info", message: "Timer was already stopped." },
    }),
  );
  info.interactions.subscribeToasts((toast) => toasts.push(toast));
  await info.actions.execute("probe", info.action, true);
  expect(toasts).toEqual([
    { variant: "info", message: "Timer was already stopped." },
  ]);
  info.actions.dispose();
  const calls: unknown[] = [];
  const f = fixture((id, args) => {
    calls.push([id, args]);
    return Promise.resolve({
      type: "done",
      notice: { type: "success", message: "Timer stopped." },
    });
  });
  await f.actions.execute("probe", f.action, true);
  expect(calls).toEqual([["stop", { reason: "human" }]]);
  const echoed: unknown[] = [];
  f.interactions.subscribeToasts((toast) => echoed.push(toast));
  await f.actions.execute("probe", f.action, true);
  expect(echoed).toEqual([]);
  expect(f.interactions.snapshot()).toEqual({ open: undefined });
  expect(f.actions.snapshot().get(f.action)).toEqual({ pending: false });
  f.actions.dispose();
});

it("waiting cancellation rejects an advertised prompt without opening or answering it", async () => {
  let calls = 0;
  const f = fixture(() => {
    calls += 1;
    return Promise.resolve({
      type: "prompt",
      prompt: { type: "text", message: "Explain why" },
      next: { arguments: {}, answer: "reason" },
    });
  });
  await f.actions.execute("probe", f.action, true);
  expect(calls).toBe(1);
  expect(f.interactions.snapshot().open).toBeUndefined();
  expect(f.interactions.snapshot().notice).toEqual({
    tone: "error",
    message: "A waiting cancellation cannot request an answer",
  });
  expect(f.actions.snapshot().get(f.action)?.error).toBe(
    "A waiting cancellation cannot request an answer",
  );
  f.actions.dispose();
});

it("refuses stale and offline rows and drops a late selected-Session result", async () => {
  let finish:
    | ((value: {
        type: "done";
        notice: { type: "success"; message: string };
      }) => void)
    | undefined;
  let calls = 0;
  const f = fixture(() => {
    calls += 1;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const running = f.actions.execute("probe", f.action, true);
  await expect.poll(() => finish).toBeDefined();
  expect(f.actions.snapshot().get(f.action)).toEqual({ pending: true });
  await f.actions.execute("probe", f.action, true);
  expect(calls).toBe(1);
  f.actions.dispose();
  finish?.({
    type: "done",
    notice: { type: "success", message: "Old Session stopped" },
  });
  await running;
  expect(f.interactions.snapshot().notice).toBeUndefined();
  expect(f.actions.snapshot().size).toBe(0);
  const offline = fixture(() => {
    return Promise.reject(new Error("Offline action ran"));
  });
  offline.disconnect();
  await offline.actions.execute("probe", offline.action, true);
  offline.actions.dispose();
  const stale = fixture(() => {
    return Promise.reject(new Error("Stale action ran"));
  });
  stale.retire();
  await stale.actions.execute("probe", stale.action, true);
  stale.actions.dispose();
});

it("keeps pending intent across fresh admitted row objects and drops retired state", async () => {
  let finish: ((value: { type: "done" }) => void) | undefined;
  const completed = new Promise<{ type: "done" }>((resolve) => {
    finish = resolve;
  });
  let calls = 0;
  const f = fixture(() => {
    calls += 1;
    return completed;
  });
  const running = f.actions.execute("probe", f.action, true);
  await expect.poll(() => calls).toBe(1);
  const refreshed = f.reproject();
  expect(f.actions.snapshot().get(refreshed)).toEqual({ pending: true });
  expect(f.actions.snapshot().has(f.action)).toBe(false);
  await f.actions.execute("probe", refreshed, true);
  expect(calls).toBe(1);
  finish?.({ type: "done" });
  await running;
  expect(f.actions.snapshot().get(refreshed)).toEqual({ pending: false });
  f.retire();
  f.actions.refresh();
  expect(f.actions.snapshot().size).toBe(0);
  f.actions.dispose();
});

for (const detached of [false, true]) {
  it(`retains the original rejected cause in the redacted log${detached ? " after detach" : " while live"}`, async () => {
    const cause = detached
      ? new Error("Detached command failed")
      : { code: "link_closed" };
    let reject: ((cause: unknown) => void) | undefined;
    const execution = new Promise<WhistleExecutionOutcome>((_resolve, fail) => {
      reject = fail;
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const f = fixture(() => Promise.resolve({ type: "done" }), {
      execute: () => execution,
    });
    try {
      const running = f.actions.execute("probe", f.action, true);
      if (detached) f.actions.dispose();
      if (reject === undefined) throw new Error("Missing fixture rejection");
      reject(cause);
      await running;
      expect(log).toHaveBeenCalledTimes(1);
      const retained: unknown = log.mock.calls[0]?.[1];
      if (!Redacted.isRedacted(retained))
        throw new Error("Missing redacted original cause");
      expect(Redacted.value(retained)).toBe(cause);
      if (detached) {
        expect(f.actions.snapshot().size).toBe(0);
        expect(f.interactions.snapshot().notice).toBeUndefined();
      } else {
        expect(f.actions.snapshot().get(f.action)).toEqual({
          pending: false,
          error: "Client row command failed",
        });
        expect(f.interactions.snapshot().notice).toEqual({
          tone: "error",
          message: "Client row command failed",
        });
      }
    } finally {
      f.actions.dispose();
      log.mockRestore();
    }
  });
}
