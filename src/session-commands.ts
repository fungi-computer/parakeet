import { nanoid } from "@fungi.computer/cairn";
import { ShiitakeError } from "@fungi.computer/shiitake";
import type {
  CancelResult,
  ForkedSession,
} from "@fungi.computer/shiitake/client";
import type { ParakeetSessionCommand } from "./session.js";
import type {
  WhistleExecutionInput,
  WhistleInteraction,
  WhistleRuntime,
} from "@fungi.computer/whistle";
import { z } from "zod";

import { buildDurableTimeline } from "./core/build-timeline.js";
import {
  sessionActivityStatus,
  sessionViewState,
  type SessionViewFacts,
} from "./core/session-view-state.js";
import type { UserMessageItem } from "./store/types.js";

/** A choice prompt holds at most 256 options; the default read already bounds this. */
const maxForkOptions = 200;

const queueArguments = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("list") }),
  z.strictObject({ action: z.literal("editLast") }),
]);
const queueArgumentsSchema = z
  .record(z.string(), z.json())
  .parse(structuredClone(z.toJSONSchema(queueArguments)));

export type SessionCommandRuntime = Pick<WhistleRuntime, "contribute">;
export type SessionCommandSession = Readonly<{
  read: () => Promise<
    Readonly<{
      sessionId: string;
      messages?: Parameters<typeof buildDurableTimeline>[0];
      compactions?: Parameters<typeof buildDurableTimeline>[1];
      pending: Readonly<{
        hasMore?: boolean;
        prompts: readonly Readonly<{
          commandId: string;
          text: string;
          delivery: "steer" | "followUp";
        }>[];
      }>;
    }> &
      SessionViewFacts
  >;
  cancel?:
    | ((
        input: Readonly<{ commandId: string; onlyIfPending?: boolean }>,
      ) => Promise<CancelResult>)
    | undefined;
  /** Execute a type-discriminated Session command, including `fork`. */
  command: ParakeetSessionCommand;
}>;

/** Shared Session actions with optional human presentation callbacks. */
export type ParakeetSessionCommandOptions = Readonly<{
  /** Host source that owns the contribution lease. */
  sourceId: string;
  /** Namespace for the Session commands. */
  namespace: string;
  /** Open the host's saved-Session chooser. */
  sessionResume?: (() => void | Promise<void>) | undefined;
  /** Whether this host currently supports saved-Session selection. */
  sessionResumeAvailable: boolean;
  /** Restore an owner-withdrawn queued prompt into the host composer. */
  onEditQueued?: (text: string) => void;
  /** Refuse withdrawal while the host has a draft that must be preserved. */
  canEditQueued?: () => boolean;
  /** Navigate to the Session a fork just created. */
  onForked?: ((sessionId: string) => void | Promise<void>) | undefined;
  /** Whether this host currently supports navigating to a forked Session. */
  forkAvailable: boolean;
  /** Show a title the owner just saved; null means the derived title is back. */
  onTitled?: ((title: string | null) => void | Promise<void>) | undefined;
}>;

/** The owner's bound for one user-set Session title, in code points. */
const maxTitleLength = 120;

const nameArguments = z
  .strictObject({ title: z.string() })
  .optional()
  .transform((value) => value?.title.trim().replaceAll(/\s+/gu, " ") ?? "");

/** The owner's bound for one compaction focus, in UTF-16 units. */
const maxCompactionInstructions = 4_096;

const compactArguments = z
  .strictObject({ instructions: z.string() })
  .optional()
  .transform((value) => value?.instructions.trim() ?? "");

/** Tell the human, when one is present, and return the same text. */
function tell(interaction: WhistleInteraction | undefined, message: string) {
  interaction?.notify({ type: "info", message });
  return message;
}

/** Contribute the shared Session command vocabulary to one Whistle host. */
export function contributeSessionCommands(
  commands: Pick<SessionCommandRuntime, "contribute">,
  session: SessionCommandSession,
  options: ParakeetSessionCommandOptions,
) {
  const unavailable = (name: string): never => {
    throw new Error(`${name} is unavailable in this host.`);
  };
  const contribution = {
    sourceId: options.sourceId,
    namespace: options.namespace,
    commands: [
      {
        id: "session",
        title: "Session status",
        category: "Advanced",
        projections: {
          help: { order: 1 },
          palette: { order: 1 },
          slash: { aliases: ["session"], order: 1 },
        },
        handler: async ({ interaction }: WhistleExecutionInput) => {
          const snapshot = await session.read();
          return tell(
            interaction,
            `Session ${snapshot.sessionId} is ${sessionActivityStatus(sessionViewState(snapshot))}; ${String(snapshot.pending.prompts.length)} queued prompt${snapshot.pending.prompts.length === 1 ? "" : "s"}.`,
          );
        },
      },
      {
        id: "queue",
        title: "Queued prompts",
        category: "Advanced",
        projections: {
          help: { order: 3 },
          palette: { order: 3 },
          slash: {
            aliases: ["queue"],
            order: 3,
            arguments: {
              hint: "list | edit-last",
              words: [
                {
                  word: "list",
                  description: "List accepted queued prompts",
                  arguments: { action: "list" },
                },
                {
                  word: "edit-last",
                  description: "Return the last queued prompt to the composer",
                  arguments: { action: "editLast" },
                },
              ],
            },
          },
        },
        action: { inputSchema: queueArgumentsSchema },
        handler: async ({
          arguments: rawArguments,
          interaction,
        }: WhistleExecutionInput) => {
          const args = queueArguments.safeParse(
            rawArguments ?? { action: "list" },
          );
          if (!args.success)
            throw new Error("/queue requires list or editLast.");
          const snapshot = await session.read();
          if (args.data.action === "list") {
            const prompts = snapshot.pending.prompts;
            const settled = snapshot.terminals.map(
              (terminal) => `${terminal.outcome} · ${terminal.commandId}`,
            );
            tell(
              interaction,
              prompts.length === 0 && settled.length === 0
                ? "No queued prompts."
                : [
                    ...prompts.map(
                      (prompt, index) =>
                        `${String(index + 1)}. queued · accepted: ${prompt.text}`,
                    ),
                    ...settled,
                    ...(snapshot.pending.hasMore === true
                      ? ["More accepted prompts are waiting outside this view."]
                      : []),
                  ].join("\n"),
            );
            return;
          }
          if (snapshot.pending.hasMore === true)
            throw new Error(
              "The queue view is incomplete; refresh it before editing the last prompt.",
            );
          const prompt = [...snapshot.pending.prompts]
            .reverse()
            .find((candidate) => candidate.delivery === "followUp");
          if (prompt === undefined)
            throw new Error("There is no queued follow-up to edit.");
          if (session.cancel === undefined)
            throw new Error("Queue editing is unavailable in this host.");
          if (options.onEditQueued === undefined)
            throw new Error(
              "Editing queued prompts is unavailable in this host.",
            );
          if (options.canEditQueued?.() === false)
            throw new Error(
              "Clear or submit the current draft before editing a queued prompt.",
            );
          const withdrawn = await session.cancel({
            commandId: prompt.commandId,
            onlyIfPending: true,
          });
          if (withdrawn.status === "too_late")
            throw new Error(
              "That queued prompt has already started; it can no longer be edited.",
            );
          options.onEditQueued(prompt.text);
          tell(
            interaction,
            "Queued prompt returned to the composer for editing.",
          );
        },
      },
      {
        id: "resume",
        title: "Resume a conversation",
        category: "Conversation",
        projections: {
          help: { order: 5 },
          palette: { order: 5 },
          slash: { aliases: ["resume"], order: 5 },
        },
        handler: async () => {
          if (
            !options.sessionResumeAvailable ||
            options.sessionResume === undefined
          ) {
            unavailable("/resume");
            return;
          }
          await options.sessionResume();
        },
      },
      {
        id: "fork",
        title: "Fork conversation",
        category: "Conversation",
        projections: {
          help: { order: 7 },
          palette: { order: 7 },
          slash: { aliases: ["fork"], order: 7 },
        },
        handler: async ({ interaction }: WhistleExecutionInput) => {
          if (!options.forkAvailable || options.onForked === undefined) {
            unavailable("/fork");
            return;
          }
          const snapshot = await session.read();
          if (sessionActivityStatus(sessionViewState(snapshot)) !== "idle")
            throw new Error("Wait for the current run to finish, then fork.");
          const candidates = buildDurableTimeline(
            snapshot.messages ?? [],
            snapshot.compactions ?? [],
          ).items.filter(
            (item): item is UserMessageItem => item.kind === "user_message",
          );
          if (candidates.length === 0)
            throw new Error("No messages to fork from.");
          if (interaction === undefined)
            throw new Error("Forking a Session needs a person.");
          const ordered = [...candidates].reverse().slice(0, maxForkOptions);
          const answer = await interaction.prompt({
            type: "choice",
            message: "Fork from message",
            options: ordered.map((item) => ({
              value: item.id,
              label: item.text.slice(0, 100) || "(empty message)",
            })),
          });
          let forked: ForkedSession;
          try {
            forked = await session.command({ type: "fork", entryId: answer });
          } catch (error) {
            if (error instanceof ShiitakeError) {
              if (error.boundary === "runtime" && error.cause === "conflict")
                throw new Error(
                  "Wait for the current run to finish, then fork.",
                  { cause: error },
                );
              if (error.boundary === "store" && error.cause === "unavailable")
                throw new Error(
                  "That message is no longer available to fork from.",
                  { cause: error },
                );
              if (error.boundary === "runtime" && error.cause === "rejected")
                throw new Error(
                  "This Session is bound to a channel and cannot be forked.",
                  { cause: error },
                );
            }
            throw error;
          }
          await options.onForked(forked.sessionId);
          tell(interaction, "Forked into a new Session.");
        },
      },
      {
        id: "compact",
        title: "Compact conversation",
        category: "Conversation",
        description:
          "Summarize older context now; optional text sets its focus",
        projections: {
          help: { order: 8 },
          palette: { order: 8 },
          slash: {
            aliases: ["compact"],
            order: 8,
            arguments: {
              hint: "[instructions]",
              text: { field: "instructions", arguments: {} },
            },
          },
        },
        handler: async ({
          arguments: input,
          interaction,
        }: WhistleExecutionInput) => {
          const parsed = compactArguments.safeParse(input);
          if (!parsed.success)
            throw new Error("Use /compact, or /compact <what to focus on>.");
          const instructions = parsed.data;
          if (instructions.length > maxCompactionInstructions)
            throw new Error(
              `Compaction instructions are at most ${String(maxCompactionInstructions)} characters.`,
            );
          // One request id per invocation; the owner replays a retried one.
          await session.command(
            instructions.length === 0
              ? { type: "compact", requestId: nanoid() }
              : { type: "compact", requestId: nanoid(), instructions },
          );
          return tell(
            interaction,
            "Compaction queued; it runs after any current work.",
          );
        },
      },
      {
        id: "name",
        title: "Name conversation",
        category: "Conversation",
        description: "Set the conversation title; no text restores it",
        projections: {
          help: { order: 9 },
          palette: { order: 9 },
          slash: {
            aliases: ["name"],
            order: 9,
            arguments: {
              hint: "[title]",
              text: { field: "title", arguments: {} },
            },
          },
        },
        handler: async ({
          arguments: input,
          interaction,
        }: WhistleExecutionInput) => {
          const parsed = nameArguments.safeParse(input);
          if (!parsed.success)
            throw new Error("Use /name <title>, or /name to clear it.");
          const text = parsed.data;
          if (Array.from(text).length > maxTitleLength)
            throw new Error(
              `A conversation title is at most ${String(maxTitleLength)} characters.`,
            );
          const title = text.length === 0 ? null : text;
          await session.command({ type: "title", title });
          await options.onTitled?.(title);
          return tell(
            interaction,
            title === null
              ? "Conversation title cleared; it follows the first prompt again."
              : `Conversation named "${title}".`,
          );
        },
      },
    ],
  } satisfies Parameters<SessionCommandRuntime["contribute"]>[0];
  return commands.contribute(contribution);
}
