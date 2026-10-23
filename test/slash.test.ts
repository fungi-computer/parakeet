import { createWhistle } from "@fungi.computer/whistle";
import { describe, expect, it, vi } from "vitest";

import {
  advertisedCommands,
  completeSlash,
  composerHints,
  createParakeetInteractions,
  fitHints,
  formatHints,
  parakeetBuiltinCommands,
  keyLabel,
  parseSlashDraft,
  runSlashDraft,
  slashRegistry,
  type SlashCompletion,
} from "../src/headless.js";
import {
  gardenCall,
  gardenExtensionId,
  gardenSlots,
  slashParityCases,
  slashParityFlow,
} from "@fungi.computer/parakeet-testing";

function gardenRuntime() {
  const runtime = createWhistle();
  runtime.contribute({
    sourceId: "parakeet",
    namespace: "parakeet",
    commands: parakeetBuiltinCommands(runtime, { clear: () => undefined }),
  });
  const advertised = advertisedCommands(
    runtime,
    {
      extension: (id) => ({
        call: (command, input) =>
          id === gardenExtensionId
            ? gardenCall(command, input)
            : Promise.reject(new Error("unknown extension")),
      }),
    },
    () => [],
  );
  expect(advertised.update(gardenSlots())).toEqual([]);
  return { runtime, advertised };
}

/** The labels a renderer must draw for a completion. */
function rowLabels(completion: SlashCompletion): readonly string[] {
  if (completion.kind === "none") return [];
  return completion.items.map((item) => item.label);
}

describe("the Parakeet command-behavior suite", () => {
  it("finishes a progress dialog with a toast, while failed attention survives time", async () => {
    const runtime = createWhistle();
    const store = createParakeetInteractions();
    const toasts: unknown[] = [];
    store.subscribeToasts((toast) => toasts.push(toast));
    store.attach(runtime.present);
    runtime.contribute({
      sourceId: "notice-proof",
      namespace: "notice-proof",
      commands: [
        {
          id: "refresh",
          title: "Refresh",
          category: "Advanced",
          handler: ({ interaction }) => {
            interaction?.notify({ type: "progress", message: "Refreshing…" });
            interaction?.notify({
              type: "info",
              message: "One source needs a restart.",
            });
          },
        },
      ],
    });
    await runtime.execute("notice-proof:refresh", { origin: "slash" });
    expect(store.snapshot().open).toBeUndefined();
    expect(toasts).toEqual([
      { variant: "info", message: "One source needs a restart." },
    ]);
    vi.useFakeTimers();
    try {
      store.report({ tone: "error", message: "Connection failed." });
      vi.advanceTimersByTime(60_000);
      expect(store.snapshot().notice).toEqual({
        tone: "error",
        message: "Connection failed.",
      });
      store.report(undefined);
      expect(store.snapshot().notice).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("help opens the host command palette when the renderer owns one", async () => {
    const runtime = createWhistle();
    let opened = 0;
    runtime.contribute({
      sourceId: "parakeet",
      namespace: "parakeet",
      commands: parakeetBuiltinCommands(runtime, {
        clear: () => undefined,
        showCommands: () => {
          opened += 1;
        },
      }),
    });
    await expect(
      runSlashDraft("/help", runtime, () => undefined, "slash"),
    ).resolves.toEqual({ status: "handled" });
    expect(opened).toBe(1);
  });

  it.each(slashParityCases)("completes $draft", ({ draft, rows }) => {
    const { runtime } = gardenRuntime();
    expect(
      rowLabels(completeSlash(slashRegistry(runtime.snapshot()), draft)),
    ).toEqual(rows);
  });

  it("parses words, free text, bare aliases and refusals", () => {
    const registry = slashRegistry(gardenRuntime().runtime.snapshot());
    expect(parseSlashDraft(registry, "hello /water")).toEqual({
      kind: "prompt",
    });
    expect(parseSlashDraft(registry, "/water")).toMatchObject({
      kind: "command",
      command: { commandId: "test-garden:water" },
    });
    expect(parseSlashDraft(registry, "/water all")).toMatchObject({
      arguments: { bed: "all" },
    });
    expect(parseSlashDraft(registry, "/water  the fern ")).toMatchObject({
      arguments: { bed: "the fern" },
    });
    expect(parseSlashDraft(registry, "/help me")).toEqual({
      kind: "invalid",
      message: "/help takes no arguments.",
    });
    expect(parseSlashDraft(registry, "/nope")).toMatchObject({
      kind: "invalid",
    });
  });

  it("runs an advertised flow without keeping its success echo", async () => {
    const { runtime } = gardenRuntime();
    const toasts: unknown[] = [];
    const store = createParakeetInteractions();
    store.subscribeToasts((toast) => toasts.push(toast));
    store.attach(runtime.present);
    const running = runSlashDraft(
      slashParityFlow.draft,
      runtime,
      () => undefined,
      "slash",
    );
    await expect.poll(() => store.snapshot().open).toBeDefined();
    const open = store.snapshot().open;
    const prompt = open?.host.snapshot().prompt;
    expect(prompt?.request).toMatchObject({ message: slashParityFlow.prompt });
    open?.host.answer(prompt?.sequence ?? -1, "fern");
    await expect(running).resolves.toEqual({ status: "handled" });
    // Completing a prompted action is no reason to keep a confirmation dialog.
    expect(store.snapshot().open).toBeUndefined();
    expect(store.snapshot().notice).toBeUndefined();
    await runSlashDraft("/water all", runtime, () => undefined, "slash");
    // A success only confirms what the person just did: no footer line, no toast.
    expect(store.snapshot()).toEqual({ open: undefined, notice: undefined });
    expect(toasts).toEqual([]);
  });

  it("adds and withdraws commands when the backend's catalog changes", () => {
    const { runtime, advertised } = gardenRuntime();
    expect(runtime.snapshot().slash.map((row) => row.alias)).toContain("water");
    advertised.update({});
    expect(runtime.snapshot().slash.map((row) => row.alias)).not.toContain(
      "water",
    );
    expect(
      advertised.update({
        broken: {
          status: "running",
          revision: "r",
          value: null,
          catalog: { protocol: "whistle.catalog/v9", commands: [] },
        },
      }),
    ).toMatchObject([{ extensionId: "broken" }]);
  });
});

describe("key hints", () => {
  const bindings = [
    {
      commandId: "tui:details",
      keys: "Ctrl+O",
      title: "Toggle details",
      order: 2,
    },
    {
      commandId: "tui:cancel",
      keys: "Esc",
      title: "Cancel the current run",
      order: 1,
    },
  ];
  it("omits the newline hint when the host leaves its key unspecified", () => {
    expect(
      formatHints(
        composerHints({
          completion: { kind: "none" },
          busy: false,
          bindings: [],
          keys: {},
        }),
      ),
    ).toBe("Enter send · / commands");
  });
  it("follow the composer state and the live bindings", () => {
    const idle = composerHints({
      completion: { kind: "none" },
      busy: false,
      bindings,
      keys: { newline: "Alt+Enter", scroll: "PgUp/PgDn" },
    });
    expect(formatHints(idle)).toBe(
      "Enter send · Alt+Enter newline · PgUp/PgDn scroll · Ctrl+O toggle details · / commands",
    );
    expect(formatHints(fitHints(idle, 40))).toBe(
      "Enter send · Alt+Enter newline",
    );
    const busy = composerHints({
      completion: { kind: "none" },
      busy: true,
      bindings,
      keys: { newline: "Alt+Enter", queue: "Tab" },
    });
    expect(formatHints(fitHints(busy, 30))).toBe("Enter send · Tab queue");
    const completing = composerHints({
      completion: completeSlash(
        slashRegistry(gardenRuntime().runtime.snapshot()),
        "/w",
      ),
      busy: false,
      bindings,
      keys: { newline: "Alt+Enter" },
    });
    expect(formatHints(completing)).toBe(
      "↑↓ choose · Tab complete · Enter run · Esc dismiss",
    );
  });
});

describe("human key names", () => {
  it.each([
    ["<leader>x", false, "Ctrl K x"],
    ["<leader>:", false, "Ctrl K :"],
    ["mod+k", false, "Ctrl K"],
    ["mod+k", true, "⌘ K"],
    ["mod+o", false, "Ctrl+O"],
    ["mod+o", true, "⌘+O"],
    ["ctrl+k", true, "Ctrl K"],
    ["escape", false, "Esc"],
  ])("formats %s for the actual platform", (binding, mac, expected) => {
    expect(keyLabel(binding, mac)).toBe(expected);
  });
});

describe("conversation-first completion", () => {
  it("lists the caller's prompt category without changing the conversation default", () => {
    const runtime = createWhistle();
    runtime.contribute({
      sourceId: "prints",
      namespace: "prints",
      commands: [
        {
          id: "clear",
          title: "Clear prompt",
          category: "Prompt",
          projections: { slash: { aliases: ["clear"] } },
          handler: () => undefined,
        },
        {
          id: "goal",
          title: "Goal",
          category: "Conversation",
          projections: { slash: { aliases: ["goal"] } },
          handler: () => undefined,
        },
      ],
    });
    const registry = slashRegistry(runtime.snapshot());
    expect(
      rowLabels(completeSlash(registry, "/", { idleCategory: "Prompt" })),
    ).toEqual(["/clear"]);
    expect(rowLabels(completeSlash(registry, "/"))).toEqual(["/goal"]);
    expect(
      rowLabels(completeSlash(registry, "/cl", { idleCategory: "Prompt" })),
    ).toEqual(["/clear"]);
  });

  it("closes an answered picker when its closing receipt is informational", async () => {
    const runtime = createWhistle();
    const store = createParakeetInteractions();
    const toasts: unknown[] = [];
    store.subscribeToasts((toast) => toasts.push(toast));
    store.attach(runtime.present);
    runtime.contribute({
      sourceId: "test",
      namespace: "test",
      commands: [
        {
          id: "choose",
          title: "Choose",
          category: "Conversation",
          handler: async ({ interaction }) => {
            if (interaction === undefined) throw new Error("Missing presenter");
            await interaction.prompt({
              type: "choice",
              message: "Fork from message",
              options: [{ value: "first", label: "First message" }],
            });
            interaction.notify({
              type: "info",
              message: "Forked into a new Session.",
            });
          },
        },
      ],
    });
    const running = runtime.execute("test:choose", { origin: "slash" });
    await expect.poll(() => store.snapshot().open).toBeDefined();
    const host = store.snapshot().open?.host;
    host?.answer(host.snapshot().prompt?.sequence ?? -1, "first");
    await running;
    expect(store.snapshot()).toMatchObject({
      open: undefined,
    });
    expect(store.snapshot().notice).toBeUndefined();
    expect(toasts).toEqual([
      { variant: "info", message: "Forked into a new Session." },
    ]);
  });

  it("shows available conversation actions by default and advanced actions only for their typed prefix", () => {
    const runtime = createWhistle();
    runtime.contribute({
      sourceId: "completion",
      namespace: "completion",
      commands: [
        {
          id: "goal",
          title: "Goal",
          category: "Conversation",
          projections: { slash: { aliases: ["goal"] } },
          handler: () => undefined,
        },
        {
          id: "retry",
          title: "Retry",
          category: "Conversation",
          availability: () => ({
            status: "unavailable",
            reason: "No failed run.",
          }),
          projections: {
            slash: {
              aliases: ["retry"],
              arguments: {
                hint: "<action>",
                words: [
                  {
                    word: "last",
                    arguments: {},
                    description: "Retry the last run",
                  },
                ],
              },
            },
          },
          handler: () => undefined,
        },
        {
          id: "model",
          title: "Model",
          category: "Settings",
          projections: { slash: { aliases: ["model"] } },
          handler: () => undefined,
        },
        {
          id: "session",
          title: "Session status",
          category: "Advanced",
          projections: { slash: { aliases: ["session"] } },
          handler: () => undefined,
        },
      ],
    });
    const registry = slashRegistry(runtime.snapshot());
    expect(rowLabels(completeSlash(registry, "/"))).toEqual([
      "/model",
      "/goal",
    ]);
    expect(rowLabels(completeSlash(registry, "/r"))).toEqual([]);
    expect(completeSlash(registry, "/retry ")).toEqual({ kind: "none" });
    expect(rowLabels(completeSlash(registry, "/ess"))).toEqual([]);
    expect(rowLabels(completeSlash(registry, "/sess"))).toEqual(["/session"]);
    expect(rowLabels(completeSlash(registry, "/model"))).toEqual(["/model"]);
    expect(parseSlashDraft(registry, "/session")).toMatchObject({
      kind: "command",
    });
  });
});
it("opens local inspection only after a bare human command succeeds, never after an action, refusal or withdrawal", async () => {
  const runtime = createWhistle();
  const inspected: unknown[] = [];
  let refuse = false;
  let withdraw = false;
  let cancelled = false;
  const advertised = advertisedCommands(
    runtime,
    {
      extension: () => ({
        call: () => {
          if (refuse) return Promise.reject(new Error("Refused"));
          if (withdraw) advertised.update({});
          return Promise.resolve(
            cancelled
              ? { type: "done", result: { cancelled: true } }
              : { type: "done" },
          );
        },
      }),
    },
    () => [],
    (entryId, commandId) => inspected.push([entryId, commandId]),
  );
  const slots = {
    probe: {
      status: "running",
      revision: "sha256:fixture",
      value: {},
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
  } as const;
  advertised.update(slots);
  await runSlashDraft("/inspect", runtime, () => undefined, "slash");
  expect(inspected).toEqual([["probe", "inspect"]]);
  await runtime.execute("probe:inspect", { origin: "agent" });
  expect(inspected).toHaveLength(1);
  // A row action such as "Clear plan" acts on the row instead of opening it.
  await runtime.execute("probe:inspect", {
    origin: "menu",
    arguments: { action: "clear" },
  });
  expect(inspected).toHaveLength(1);
  cancelled = true;
  await runSlashDraft("/inspect", runtime, () => undefined, "slash");
  expect(inspected).toHaveLength(1);
  cancelled = false;
  refuse = true;
  await runSlashDraft("/inspect", runtime, () => undefined, "slash");
  expect(inspected).toHaveLength(1);
  refuse = false;
  withdraw = true;
  await runSlashDraft("/inspect", runtime, () => undefined, "slash");
  expect(inspected).toHaveLength(1);
});

it("bare slash includes model, login and help alongside conversation commands", () => {
  const runtime = createWhistle();
  runtime.contribute({
    sourceId: "common",
    namespace: "common",
    commands: ["model", "login", "help", "keys"].map((id) => ({
      id,
      title: id,
      category: "Advanced",
      projections: { slash: { aliases: [id] } },
      handler: () => undefined,
    })),
  });
  expect(
    rowLabels(completeSlash(slashRegistry(runtime.snapshot()), "/")),
  ).toEqual(["/help", "/login", "/model"]);
});

it("consumes the draft on valid available dispatch, independently of alias and handler outcome", async () => {
  const runtime = createWhistle();
  let consumed = 0;
  runtime.contribute({
    sourceId: "draft",
    namespace: "draft",
    commands: [
      {
        id: "inspect",
        title: "Inspect",
        category: "Settings",
        projections: { slash: { aliases: ["look"], consumesDraft: true } },
        handler: () => {
          expect(consumed).toBe(1);
          throw new Error("Nothing to inspect.");
        },
      },
      {
        id: "unavailable",
        title: "Unavailable",
        category: "Settings",
        projections: {
          slash: { aliases: ["unavailable"], consumesDraft: true },
        },
        availability: () => ({ status: "unavailable", reason: "Not ready" }),
        handler: () => undefined,
      },
      {
        id: "ordinary",
        title: "Ordinary",
        category: "Settings",
        projections: { slash: { aliases: ["ordinary"] } },
        handler: () => {
          throw new Error("Keep the draft.");
        },
      },
    ],
  });
  const consume = () => {
    consumed += 1;
  };
  for (const draft of [
    "/unavailable",
    "/ordinary",
    "/look extra",
    "/missing",
  ]) {
    await runSlashDraft(draft, runtime, () => undefined, "slash", consume);
    expect(consumed).toBe(0);
  }
  expect(
    await runSlashDraft("/look ", runtime, () => undefined, "slash", consume),
  ).toMatchObject({ status: "failed" });
  expect(consumed).toBe(1);
});
