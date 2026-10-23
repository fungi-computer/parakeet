import { expect, it } from "vitest";
import { createWhistle } from "@fungi.computer/whistle";
import { createWhistleInteractionHost } from "@fungi.computer/whistle/interaction";
import * as Schema from "effect/Schema";
import type { Json } from "@fungi.computer/shiitake/extensions";
import { advertisedCommands } from "../src/commands/advertised.js";
import { createParakeetInteractions } from "../src/commands/interactions.js";
import type { ClientContribution } from "../src/core/client-contributions.js";

it.each(["explicit", "implicit", "late reply", "chooser"])(
  "retires only the unanswered panel intent through %s admission",
  async (admission) => {
    const commands = createWhistle();
    const interactions = createParakeetInteractions();
    const detach = interactions.attach(commands.present);
    const rows = (ids: string[]): readonly ClientContribution[] => [
      {
        entryId: "questions",
        value: {
          chips: [],
          panel: ids.map((askId) => ({
            id: askId,
            title: askId,
            actions: [{ id: "answer", label: "Answer", input: { askId } }],
          })),
          timeline: { cells: [], omitted: 0 },
          waiting: null,
        },
      },
    ];
    let contributions = rows(["first", "second"]);
    let resolveReply: ((value: Json) => void) | undefined;
    const reply = new Promise<Json>((resolve) => {
      resolveReply = resolve;
    });
    const step: Json = {
      type: "prompt",
      prompt: {
        type: "choice",
        message: "Which store?",
        options:
          admission === "chooser"
            ? [
                { value: "first", label: "First question" },
                { value: "second", label: "Second question" },
              ]
            : [{ value: "sqlite", label: "SQLite" }],
      },
      next: {
        arguments: admission === "chooser" ? {} : { askId: "first" },
        answer: "selection",
      },
    };
    let calls = 0;
    const owner = advertisedCommands(
      commands,
      {
        extension: () => ({
          call: () => {
            calls += 1;
            return admission === "late reply" ? reply : Promise.resolve(step);
          },
        }),
      },
      () => contributions,
    );
    const slots = {
      questions: {
        status: "running",
        revision: "sha256:questions",
        value: {},
        catalog: {
          protocol: "whistle.catalog/v1",
          commands: [{ id: "answer", title: "Answer", category: "Questions" }],
        },
      },
    } as const;
    owner.update(slots);
    const running = commands.execute("questions:answer", {
      origin: "slash",
      arguments:
        admission === "implicit" || admission === "chooser"
          ? {}
          : { askId: "first" },
    });
    try {
      await expect.poll(() => calls).toBe(1);
      if (admission !== "late reply")
        await expect.poll(() => interactions.snapshot().open).toBeDefined();
      const opened = interactions.snapshot().open;
      contributions = rows(["first"]);
      owner.update(slots);
      if (admission === "chooser") {
        await running;
        expect(interactions.snapshot().open).toBeUndefined();
        expect(contributions[0]?.value.panel).toHaveLength(1);
      } else {
        expect(interactions.snapshot().open).toBe(opened);
        contributions = rows([]);
        owner.update(slots);
      }
      resolveReply?.(step);
      await running;
      expect(interactions.snapshot().open).toBeUndefined();
      expect(interactions.snapshot().notice).toBeUndefined();
      expect(calls).toBe(1);
    } finally {
      resolveReply?.(step);
      owner.dispose();
      interactions.close();
      await running;
      detach();
      commands.close();
    }
  },
);

it("keeps concurrent invocation identities separate when caller signals are shared", async () => {
  const commands = createWhistle();
  const controller = new AbortController();
  const firstHost = createWhistleInteractionHost({ title: "First" });
  const secondHost = createWhistleInteractionHost({ title: "Second" });
  const rows = (ids: string[]): readonly ClientContribution[] => [
    {
      entryId: "questions",
      value: {
        chips: [],
        panel: ids.map((askId) => ({
          id: askId,
          title: askId,
          actions: [{ id: "answer", label: "Answer", input: { askId } }],
        })),
        timeline: { cells: [], omitted: 0 },
        waiting: null,
      },
    },
  ];
  let contributions = rows(["first", "second"]);
  const decode = Schema.decodeUnknownSync(
    Schema.Struct({
      askId: Schema.optionalKey(Schema.String),
    }),
  );
  const owner = advertisedCommands(
    commands,
    {
      extension: () => ({
        call: (_name, args) => {
          const askId = decode(args).askId ?? "first";
          return Promise.resolve({
            type: "prompt",
            prompt: { type: "text", message: askId },
            next: { arguments: { askId }, answer: "selection" },
          });
        },
      }),
    },
    () => contributions,
  );
  const slots = {
    questions: {
      status: "running",
      revision: "sha256:questions",
      value: {},
      catalog: {
        protocol: "whistle.catalog/v1",
        commands: [{ id: "answer", title: "Answer", category: "Questions" }],
      },
    },
  } as const;
  owner.update(slots);
  const first = commands.execute("questions:answer", {
    origin: "slash",
    arguments: {},
    signal: controller.signal,
    interaction: firstHost.begin().interaction,
  });
  const second = commands.execute("questions:answer", {
    origin: "slash",
    arguments: { askId: "second" },
    signal: controller.signal,
    interaction: secondHost.begin().interaction,
  });
  try {
    await expect
      .poll(() => firstHost.snapshot().prompt?.request.message)
      .toBe("first");
    await expect
      .poll(() => secondHost.snapshot().prompt?.request.message)
      .toBe("second");
    contributions = rows(["first"]);
    owner.update(slots);
    await second;
    expect(secondHost.snapshot().prompt).toBeUndefined();
    expect(firstHost.snapshot().prompt?.request.message).toBe("first");
    contributions = rows([]);
    owner.update(slots);
    await first;
    expect(firstHost.snapshot().prompt).toBeUndefined();
  } finally {
    owner.dispose();
    firstHost.cancel();
    secondHost.cancel();
    await Promise.all([first, second]);
    commands.close();
  }
});
