import { nanoid } from "@fungi.computer/cairn";
import { ShiitakeError } from "@fungi.computer/shiitake";
import type { ParakeetSessionCommand } from "./session.js";
import type {
  WhistleExecutionInput,
  WhistleInteraction,
  WhistleRuntime,
} from "@fungi.computer/whistle";
import { z } from "zod";

import { buildDurableTimeline } from "./core/build-timeline.js";
import { formatWhen, oneLine } from "./core/picker-text.js";
import {
  sessionActivityStatus,
  sessionViewState,
  type SessionViewFacts,
} from "./core/session-view-state.js";
import type { UserMessageItem } from "./store/types.js";

/** A choice prompt holds at most 256 options; the default read already bounds this. */
const maxForkOptions = 200;

const queueArguments = z.strictObject({ action: z.literal("list") });
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
              hint: "list",
              words: [
                {
                  word: "list",
                  description: "List accepted queued prompts",
                  arguments: { action: "list" },
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
          if (!args.success) throw new Error("/queue requires list.");
          const snapshot = await session.read();
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
          const onForked = options.onForked;
          if (!options.forkAvailable || onForked === undefined) {
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
          const now = Date.now();
          const answer = await interaction.prompt({
            type: "choice",
            message: "Fork from which message?",
            summary: "Start a new conversation from your message.",
            options: ordered.map((item) => ({
              value: item.id,
              label: oneLine(item.text, 44) || "(empty message)",
              description:
                item.at === undefined ? undefined : formatWhen(item.at, now),
            })),
          });
          const forked = await interaction.run(async () => {
            try {
              return await session.command({ type: "fork", entryId: answer });
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
          });
          await interaction.run(async () => {
            await onForked(forked.sessionId);
          });
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
        handler: async ({ arguments: input }: WhistleExecutionInput) => {
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
          return "Compaction queued; it runs after any current work.";
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
        handler: async ({ arguments: input }: WhistleExecutionInput) => {
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
          return title === null
            ? "Conversation title cleared; it follows the first prompt again."
            : `Conversation named "${title}".`;
        },
      },
    ],
  } satisfies Parameters<SessionCommandRuntime["contribute"]>[0];
  return commands.contribute(contribution);
}
