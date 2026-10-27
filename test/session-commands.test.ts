import { parsePromptAnswer } from "@fungi.computer/whistle/wire";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { ShiitakeError } from "@fungi.computer/shiitake";
import type { SessionMessage } from "@fungi.computer/shiitake/client";
import {
  createWhistle,
  type WhistleInteraction,
  type WhistlePrompt,
  type WhistleRuntime,
} from "@fungi.computer/whistle";

import { contributeSessionCommands, runSlashDraft } from "../src/headless.js";
import { createParakeetInteractions } from "../src/commands/interactions.js";
import {
  commandHandler,
  commandResult,
  idleFacts,
  runningFacts,
} from "./fixtures/session.fixture.js";

const session = {
  read: () =>
    Promise.resolve({
      sessionId: "proof",
      activity: idleFacts,
      terminals: [],
      toolOutput: [],
      progress: null,
      pending: { total: 0, prompts: [] },
    }),
  command: commandHandler(commandResult),
};

/** Collect the notices a command sends to its human. */
function noticing(runtime: WhistleRuntime, notices: string[]) {
  return runtime.present(() => {
    const interaction: WhistleInteraction = {
      run: (operation) => operation(),
      signal: new AbortController().signal,
      prompt: () => Promise.reject(new Error("No prompts in this test")),
      notify: (notice) => {
        notices.push(notice.type === "handoff" ? notice.url : notice.message);
      },
    };
    return { interaction, settle: () => undefined };
  });
}

/** Present an interaction whose prompt answers from a fixed script. */
function presentingPrompt(
  runtime: WhistleRuntime,
  prompts: WhistlePrompt[],
  onPrompt: (prompt: WhistlePrompt) => string,
) {
  return runtime.present(() => {
    const interaction: WhistleInteraction = {
      run: (operation) => operation(),
      signal: new AbortController().signal,
      prompt: (prompt) => {
        prompts.push(prompt);
        return Promise.resolve(parsePromptAnswer(prompt, onPrompt(prompt)));
      },
      notify: () => undefined,
    };
    return { interaction, settle: () => undefined };
  });
}

/** One confirmed user message at the given durable entry id and sequence. */
function userMessage(
  id: string,
  sequence: number,
  text: string,
): SessionMessage {
  return {
    id,
    commandId: null,
    sequence,
    value: { role: "user", content: text, timestamp: sequence },
  };
}

describe("shared Parakeet Session commands", () => {
  it("retries navigation to the successful fork without forking again", async () => {
    const runtime = createWhistle();
    const interactions = createParakeetInteractions();
    const detach = interactions.attach(runtime.present);
    const forkCalls: string[] = [];
    const navigations: string[] = [];
    contributeSessionCommands(
      runtime,
      {
        read: async () => ({
          ...(await session.read()),
          messages: [userMessage("chosen-entry", 1, "Fork this message")],
        }),
        command: commandHandler(
          commandResult,
          undefined,
          undefined,
          (input) => {
            forkCalls.push(input.entryId);
            return Promise.resolve({ sessionId: "created-fork" });
          },
        ),
      },
      {
        sourceId: "fork-retry",
        namespace: "fork-retry",
        sessionResumeAvailable: false,
        forkAvailable: true,
        onForked: (sessionId) => {
          navigations.push(sessionId);
          return navigations.length === 1
            ? Promise.reject(new Error("Navigation failed"))
            : Promise.resolve();
        },
      },
    );
    const running = runtime.execute("fork-retry:fork", { origin: "slash" });
    try {
      await vi.waitFor(() => {
        expect(
          interactions.snapshot().open?.host.snapshot().prompt,
        ).toBeDefined();
      });
      const host = interactions.snapshot().open?.host;
      const pending = host?.snapshot().prompt;
      if (host === undefined || pending === undefined)
        throw new Error("Missing fork question");
      host.answer(pending.sequence, "chosen-entry");
      await vi.waitFor(() => {
        expect(host.snapshot().retryable).toBe(true);
      });
      expect(forkCalls).toEqual(["chosen-entry"]);
      expect(navigations).toEqual(["created-fork"]);
      host.retry();
      expect((await running).status).toBe("handled");
      expect(forkCalls).toEqual(["chosen-entry"]);
      expect(navigations).toEqual(["created-fork", "created-fork"]);
      expect(interactions.snapshot().open).toBeUndefined();
    } finally {
      interactions.close();
      await running;
      detach();
      runtime.close();
    }
  });

  it("lists the owner queue without offering a mutating slash command", async () => {
    const runtime = createWhistle();
    const notices: string[] = [];
    noticing(runtime, notices);
    const lease = contributeSessionCommands(
      runtime,
      {
        ...session,
        read: () =>
          session.read().then((snapshot) => ({
            ...snapshot,
            pending: {
              hasMore: true,
              prompts: [
                {
                  commandId: "work-1",
                  text: "First",
                  delivery: "followUp" as const,
                },
                {
                  commandId: "work-2",
                  text: "Last",
                  delivery: "followUp" as const,
                },
              ],
            },
          })),
      },
      {
        sourceId: "queue-test",
        namespace: "queue-test",
        sessionResumeAvailable: false,
        forkAvailable: false,
      },
    );
    const run = (draft: string) =>
      runSlashDraft(
        draft,
        runtime,
        () => {
          throw new Error("Queue command became a prompt");
        },
        "slash",
      );
    await expect(run("/queue list")).resolves.toMatchObject({
      status: "handled",
    });
    expect(notices[0]).toContain("queued · accepted: First");
    expect(notices[0]).toContain("queued · accepted: Last");
    expect(notices[0]).toContain("More accepted prompts");
    await expect(run("/queue edit-last")).resolves.toMatchObject({
      status: "failed",
    });
    await expect(
      runtime.execute("queue-test:queue", {
        origin: "slash",
        arguments: { action: "editLast" },
      }),
    ).resolves.toMatchObject({ status: "failed" });
    expect(notices).toHaveLength(1);
    lease.dispose();
  });

  it("keeps exact aliases and rejects unknown, argument-less and unavailable submissions", async () => {
    const runtime = createWhistle();
    const lease = contributeSessionCommands(runtime, session, {
      sourceId: "test",
      namespace: "test",
      sessionResumeAvailable: false,
      forkAvailable: false,
    });
    expect(runtime.snapshot().slash.map((row) => row.alias)).toEqual([
      "session",
      "queue",
      "resume",
      "fork",
      "compact",
      "name",
    ]);
    let sent = 0;
    for (const draft of [
      "/missing",
      "/resume",
      "/session now",
      "/queue sideways",
    ]) {
      const outcome = await runSlashDraft(
        draft,
        runtime,
        () => {
          sent += 1;
        },
        "slash",
      );
      expect(outcome?.status).toBe("failed");
    }
    await expect(
      runSlashDraft("/queue sideways", runtime, () => undefined, "slash"),
    ).resolves.toMatchObject({
      error: { message: "Use /queue list." },
    });
    expect(sent).toBe(0);
    lease.dispose();
  });

  it("offers durable user messages newest first, cut to one line, and forks the chosen one", async () => {
    const runtime = createWhistle();
    const long = "x".repeat(150);
    const forkCalls: string[] = [];
    const forked: string[] = [];
    const lease = contributeSessionCommands(
      runtime,
      {
        read: () =>
          Promise.resolve({
            sessionId: "proof",
            activity: idleFacts,
            terminals: [],
            toolOutput: [],
            progress: null,
            pending: { total: 0, prompts: [] },
            messages: [
              userMessage("m1", 1, "First"),
              userMessage("m2", 2, long),
              userMessage("m3", 3, "Third"),
            ],
          }),
        command: commandHandler(
          () => Promise.reject(new Error("prompt is unused in this test")),
          undefined,
          undefined,
          (input) => {
            forkCalls.push(input.entryId);
            return Promise.resolve({ sessionId: "forked-xyz" });
          },
        ),
      },
      {
        sourceId: "fork-test",
        namespace: "fork-test",
        sessionResumeAvailable: false,
        forkAvailable: true,
        onForked: (sessionId) => {
          forked.push(sessionId);
        },
      },
    );
    const prompts: WhistlePrompt[] = [];
    presentingPrompt(runtime, prompts, () => "m2");
    const outcome = await runSlashDraft(
      "/fork",
      runtime,
      () => undefined,
      "slash",
    );
    expect(outcome?.status).toBe("handled");
    expect(prompts).toHaveLength(1);
    const prompt = prompts[0];
    if (prompt?.type !== "choice") throw new Error("Expected a choice prompt");
    expect(prompt.message).toBe("Fork from which message?");
    expect(prompt.options.map((option) => option.value)).toEqual([
      "m3",
      "m2",
      "m1",
    ]);
    expect(prompt.options.find((option) => option.value === "m2")?.label).toBe(
      `${long.slice(0, 43)}…`,
    );
    expect(forkCalls).toEqual(["m2"]);
    expect(forked).toEqual(["forked-xyz"]);
    lease.dispose();
  });

  it("refuses with the busy message while a run is active, without prompting", async () => {
    const runtime = createWhistle();
    let prompted = false;
    const lease = contributeSessionCommands(
      runtime,
      {
        read: () =>
          Promise.resolve({
            sessionId: "proof",
            activity: runningFacts(),
            terminals: [],
            toolOutput: [],
            progress: null,
            pending: { total: 0, prompts: [] },
            messages: [userMessage("m1", 1, "First")],
          }),
        command: commandHandler(commandResult),
      },
      {
        sourceId: "fork-busy",
        namespace: "fork-busy",
        sessionResumeAvailable: false,
        forkAvailable: true,
        onForked: () => undefined,
      },
    );
    presentingPrompt(runtime, [], () => {
      prompted = true;
      return "m1";
    });
    await expect(
      runSlashDraft("/fork", runtime, () => undefined, "slash"),
    ).resolves.toMatchObject({
      error: { message: "Wait for the current run to finish, then fork." },
    });
    expect(prompted).toBe(false);
    lease.dispose();
  });

  it("refuses with the empty-state message when there are no user messages", async () => {
    const runtime = createWhistle();
    const lease = contributeSessionCommands(
      runtime,
      {
        read: () =>
          Promise.resolve({
            sessionId: "proof",
            activity: idleFacts,
            terminals: [],
            toolOutput: [],
            progress: null,
            pending: { total: 0, prompts: [] },
            messages: [],
          }),
        command: commandHandler(commandResult),
      },
      {
        sourceId: "fork-empty",
        namespace: "fork-empty",
        sessionResumeAvailable: false,
        forkAvailable: true,
        onForked: () => undefined,
      },
    );
    presentingPrompt(runtime, [], () => "unused");
    await expect(
      runSlashDraft("/fork", runtime, () => undefined, "slash"),
    ).resolves.toMatchObject({
      error: { message: "No messages to fork from." },
    });
    lease.dispose();
  });

  it("is unavailable until the host wires onForked", async () => {
    const runtime = createWhistle();
    const lease = contributeSessionCommands(runtime, session, {
      sourceId: "fork-unavailable",
      namespace: "fork-unavailable",
      sessionResumeAvailable: false,
      forkAvailable: true,
    });
    await expect(
      runSlashDraft("/fork", runtime, () => undefined, "slash"),
    ).resolves.toMatchObject({
      error: { message: "/fork is unavailable in this host." },
    });
    lease.dispose();
  });

  const forkFailures: readonly (readonly [Error, string])[] = [
    [
      new ShiitakeError("runtime", "conflict", "busy"),
      "Wait for the current run to finish, then fork.",
    ],
    [
      new ShiitakeError("store", "unavailable", "gone"),
      "That message is no longer available to fork from.",
    ],
    [
      new ShiitakeError("runtime", "rejected", "channel"),
      "This Session is bound to a channel and cannot be forked.",
    ],
    [new Error("boom"), "boom"],
  ];
  it.each(forkFailures)(
    "maps the fork command's failure %#",
    async (failure, message) => {
      const runtime = createWhistle();
      const lease = contributeSessionCommands(
        runtime,
        {
          read: () =>
            Promise.resolve({
              sessionId: "proof",
              activity: idleFacts,
              terminals: [],
              toolOutput: [],
              progress: null,
              pending: { total: 0, prompts: [] },
              messages: [userMessage("m1", 1, "First")],
            }),
          command: commandHandler(
            () => Promise.reject(new Error("prompt is unused in this test")),
            undefined,
            undefined,
            () => Promise.reject(failure),
          ),
        },
        {
          sourceId: "fork-error",
          namespace: "fork-error",
          sessionResumeAvailable: false,
          forkAvailable: true,
          onForked: () => undefined,
        },
      );
      presentingPrompt(runtime, [], () => "m1");
      await expect(
        runSlashDraft("/fork", runtime, () => undefined, "slash"),
      ).resolves.toMatchObject({ error: { message } });
      lease.dispose();
    },
  );

  it("reuses a grammar's request id after a failed response", async () => {
    const runtime = createWhistle();
    const requestIds: string[] = [];
    runtime.contribute({
      sourceId: "goal",
      namespace: "goal",
      commands: [
        {
          id: "goal",
          title: "Goal",
          category: "Session",
          projections: {
            slash: {
              aliases: ["goal"],
              arguments: {
                hint: "<objective>",
                text: {
                  field: "objective",
                  arguments: { action: "set" },
                  requestIdField: "requestId",
                },
              },
            },
          },
          handler: ({ arguments: args }) => {
            const { requestId } = z
              .looseObject({ requestId: z.string() })
              .parse(args);
            requestIds.push(requestId);
            if (requestIds.length === 1) throw new Error("response lost");
          },
        },
      ],
    });
    const draft = "/goal Continue after the timeout";
    const submit = () =>
      runSlashDraft(draft, runtime, () => undefined, "slash");
    await expect(submit()).resolves.toMatchObject({ status: "failed" });
    await expect(submit()).resolves.toMatchObject({ status: "handled" });
    await expect(submit()).resolves.toMatchObject({ status: "handled" });
    expect(requestIds).toHaveLength(3);
    expect(requestIds[1]).toBe(requestIds[0]);
    expect(requestIds[2]).not.toBe(requestIds[1]);
  });

  it("queues /compact as owner work with a fresh request id each time", async () => {
    const runtime = createWhistle();
    const notices: string[] = [];
    const compacts: string[] = [];
    const focuses: (string | undefined)[] = [];
    noticing(runtime, notices);
    const lease = contributeSessionCommands(
      runtime,
      {
        ...session,
        command: commandHandler(
          commandResult,
          undefined,
          undefined,
          undefined,
          (input) => {
            compacts.push(input.requestId);
            focuses.push(input.instructions);
            return commandResult(input);
          },
        ),
      },
      {
        sourceId: "compact-test",
        namespace: "compact-test",
        sessionResumeAvailable: false,
        forkAvailable: false,
      },
    );
    try {
      const run = () =>
        runSlashDraft("/compact", runtime, () => undefined, "slash");
      await expect(run()).resolves.toMatchObject({ status: "handled" });
      await expect(run()).resolves.toMatchObject({ status: "handled" });
      // Text after /compact is Pi's focus for the summary.
      await expect(
        runSlashDraft(
          "/compact   keep the API names ",
          runtime,
          () => undefined,
          "slash",
        ),
      ).resolves.toMatchObject({ status: "handled" });
      await expect(
        runSlashDraft(
          `/compact ${"x".repeat(4_097)}`,
          runtime,
          () => undefined,
          "slash",
        ),
      ).resolves.toMatchObject({ status: "failed" });
      expect(compacts).toHaveLength(3);
      expect(new Set(compacts).size).toBe(3);
      expect(focuses).toEqual([undefined, undefined, "keep the API names"]);
      // Queuing is what the person asked for: nothing is announced.
      expect(notices).toEqual([]);
    } finally {
      lease.dispose();
    }
  });

  it("names the conversation through the owner and clears it with no text", async () => {
    const runtime = createWhistle();
    const notices: string[] = [];
    const saved: (string | null)[] = [];
    const shown: (string | null)[] = [];
    noticing(runtime, notices);
    const lease = contributeSessionCommands(
      runtime,
      {
        ...session,
        command: commandHandler(commandResult, (input) => {
          if (input.type === "title") saved.push(input.title);
          return Promise.resolve(undefined);
        }),
      },
      {
        sourceId: "name-test",
        namespace: "name-test",
        sessionResumeAvailable: false,
        forkAvailable: false,
        onTitled: (title) => {
          shown.push(title);
        },
      },
    );
    try {
      const run = (draft: string) =>
        runSlashDraft(draft, runtime, () => undefined, "slash");
      await expect(run("/name   Fern   notes ")).resolves.toMatchObject({
        status: "handled",
      });
      await expect(run("/name")).resolves.toMatchObject({ status: "handled" });
      await expect(run(`/name ${"x".repeat(121)}`)).resolves.toMatchObject({
        status: "failed",
      });
      expect(saved).toEqual(["Fern notes", null]);
      expect(shown).toEqual(["Fern notes", null]);
      expect(notices).toEqual([]);
    } finally {
      lease.dispose();
    }
  });
});
