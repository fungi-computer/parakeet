import {
  parseAccepted,
  parseSessionFrame,
  parseSessionSnapshot,
  type AbortCommand,
  type Accepted,
  type BranchCommand,
  type CancelCommand,
  type CancelResult,
  type ForkCommand,
  type OperatorCommand,
  type TitleCommand,
  type ForkedSession,
  type CompactCommand,
  type PromptCommand,
  type SessionCommand,
  type SessionActivity,
  type SessionExtensionSlots,
  type SessionFrame,
  type SessionProgress,
  type SessionSnapshot,
  type SessionTerminal,
  type ShiitakeSession,
} from "@fungi.computer/shiitake/client";
import type {
  ParakeetSessionCommand,
  ParakeetPromptResult,
} from "../../src/session.js";
import type { Json } from "@fungi.computer/shiitake/extensions";
import { defineClientEntry } from "@fungi.computer/shiitake/client-entry";
import { ExtensionId } from "@fungi.computer/shiitake/extensions";
import * as Schema from "effect/Schema";

/** The scenario words fixtures use to say what a Session is doing. */
export type FixtureStatus =
  "cancelling" | "idle" | "queued" | "retrying" | "streaming" | "thinking";

/** A terminal whose order and diagnostic default when a fixture omits them. */
export type FixtureTerminal = Omit<SessionTerminal, "sequence" | "diagnostic"> &
  Partial<Pick<SessionTerminal, "sequence" | "diagnostic">>;

const idleActivity: SessionActivity = {
  queue: { state: "idle" },
  cancellationRequested: false,
  retry: null,
  activeTool: null,
  lastModelChoiceSequence: null,
  compaction: null,
};

/** Raw activity facts for a Session that is waiting for a person. */
export const idleFacts = idleActivity;

/** Raw activity facts for a Session waiting behind other work. */
export function queuedFacts(commandId = "queued-command"): SessionActivity {
  return {
    ...idleActivity,
    queue: { state: "queued", commandId, runningWork: null },
  };
}

/** Raw activity facts for a Session whose work is running. */
export function runningFacts(
  overrides: Partial<SessionActivity> = {},
): SessionActivity {
  return {
    ...idleActivity,
    queue: { state: "running", commandId: "running-command" },
    ...overrides,
  };
}

/** The activity facts a fixture with this status carries when it omits them. */
export function activityOf(status: FixtureStatus): SessionActivity {
  switch (status) {
    case "idle":
      return idleActivity;
    case "queued":
      return queuedFacts();
    case "cancelling":
      return runningFacts({ cancellationRequested: true });
    case "retrying":
      return runningFacts({
        retry: {
          attempt: 1,
          maxAttempts: 3,
          delayMs: 2_000,
          errorMessage: "overloaded",
          scheduledAt: 0,
        },
      });
    case "streaming":
    case "thinking":
      return runningFacts();
  }
}

const streamingProgress: SessionProgress = {
  messageId: "fixture-streaming",
  revision: 1,
  text: "…",
  thinking: "",
  textTruncated: false,
  thinkingTruncated: false,
};

function withTerminalDefaults(
  terminals: readonly FixtureTerminal[],
): readonly SessionTerminal[] {
  return terminals.map((terminal, index) => ({
    sequence: index + 1,
    diagnostic: null,
    ...terminal,
  }));
}

export type FixtureActivity =
  | Readonly<{ activity: SessionActivity; status?: undefined }>
  | Readonly<{ status: FixtureStatus; activity?: undefined }>;

/** A snapshot as fixtures write it: a status word or exact activity facts. */
export type FixtureSnapshot = Omit<
  Partial<SessionSnapshot>,
  "activity" | "terminals"
> &
  Partial<FixtureActivity> & { terminals?: readonly FixtureTerminal[] };

/** One readable Session baseline checked by Shiitake's canonical parser. */
export function sessionSnapshot(input: FixtureSnapshot = {}): SessionSnapshot {
  const { status, activity, terminals, ...rest } = input;
  return parseSessionSnapshot(
    JSON.stringify({
      pending: { total: 0, prompts: [], hasMore: false },
      sessionId: "session-1",
      cursor: null,
      hasMore: false,
      messages: [],
      progress: status === "streaming" ? streamingProgress : null,
      extensions: {},
      attention: [],
      ...rest,
      terminals: withTerminalDefaults(terminals ?? []),
      activity: activity ?? activityOf(status ?? "idle"),
    }),
  );
}

export type FixtureSessionUpdate = Extract<SessionFrame, { kind: "update" }>;
export type FixtureSessionProgressFrame = Extract<
  SessionFrame,
  { kind: "progress" }
>;

/** One readable live frame checked by Shiitake's canonical parser. */
export type FixtureSessionFrame =
  | SessionFrame
  | ((Omit<
      FixtureSessionUpdate,
      "activity" | "extensions" | "terminals" | "attention"
    > &
      Partial<Pick<FixtureSessionUpdate, "extensions" | "attention">> & {
        terminals: readonly FixtureTerminal[];
      }) &
      FixtureActivity)
  | (Omit<FixtureSessionProgressFrame, "activity"> & FixtureActivity);

export function sessionFrame(input: FixtureSessionFrame): SessionFrame {
  if (input.kind === "reset") return parseSessionFrame(JSON.stringify(input));
  const { status, ...frame } = { status: undefined, ...input };
  const activity = frame.activity ?? activityOf(status ?? "idle");
  return parseSessionFrame(
    JSON.stringify(
      frame.kind === "update"
        ? {
            ...frame,
            extensions: frame.extensions ?? {},
            attention: frame.attention ?? [],
            terminals: withTerminalDefaults(frame.terminals),
            activity,
          }
        : { ...frame, activity },
    ),
  );
}

/** One readable acceptance checked by Shiitake's canonical parser. */
export function accepted(commandId: string): Accepted {
  return parseAccepted(
    JSON.stringify({
      status: "accepted",
      commandId,
    }),
  );
}

/** Resolve one fake command with the same discriminator-dependent result. */
export function commandResult(
  input: PromptCommand | CompactCommand,
): Promise<Accepted>;
export function commandResult(input: CancelCommand): Promise<CancelResult>;
export function commandResult(
  input: AbortCommand | BranchCommand | OperatorCommand | TitleCommand,
): Promise<undefined>;
export function commandResult(input: ForkCommand): Promise<ForkedSession>;
export function commandResult(
  input: SessionCommand,
): Promise<Accepted | CancelResult | ForkedSession | undefined>;
export function commandResult(
  input: SessionCommand,
): Promise<Accepted | CancelResult | ForkedSession | undefined> {
  if (input.type === "prompt" || input.type === "compact")
    return Promise.resolve(accepted(input.requestId));
  if (input.type === "cancel")
    return Promise.resolve(accepted(input.commandId));
  if (input.type === "fork") return Promise.resolve({ sessionId: "fork-1" });
  return Promise.resolve(undefined);
}

/** Build one discriminator-correct fake command door without type assertions. */
export function commandHandler(
  onPrompt: (input: PromptCommand) => Promise<ParakeetPromptResult>,
  onAbort: (
    input: AbortCommand | BranchCommand | OperatorCommand | TitleCommand,
  ) => Promise<undefined> = (input) => commandResult(input),
  onCancel: (input: CancelCommand) => Promise<CancelResult> = (input) =>
    commandResult(input),
  onFork: (input: ForkCommand) => Promise<ForkedSession> = (input) =>
    commandResult(input),
  onCompact: (input: CompactCommand) => Promise<Accepted> = (input) =>
    commandResult(input),
): ParakeetSessionCommand {
  function handle(
    input: PromptCommand | CompactCommand,
  ): Promise<ParakeetPromptResult>;
  function handle(input: CancelCommand): Promise<CancelResult>;
  function handle(
    input: AbortCommand | BranchCommand | OperatorCommand | TitleCommand,
  ): Promise<undefined>;
  function handle(input: ForkCommand): Promise<ForkedSession>;
  function handle(
    input: SessionCommand,
  ): Promise<ParakeetPromptResult | CancelResult | ForkedSession | undefined>;
  function handle(input: SessionCommand) {
    if (input.type === "prompt") return onPrompt(input);
    if (input.type === "compact") return onCompact(input);
    if (input.type === "cancel") return onCancel(input);
    if (input.type === "fork") return onFork(input);
    return onAbort(input);
  }
  return handle;
}

/** A goal as fixtures write it; the visible stop reason defaults to none. */
export type FixtureGoal = Readonly<{
  revision: string;
  objective: string;
  state: "active" | "paused" | "complete" | "blocked";
  stopReason?: string | null;
}>;

/** The committed goal a running goal extension projects. */
export function committedGoal(goal: FixtureGoal) {
  return { stopReason: null, ...goal };
}

/** Snapshot or frame slots of a host that rosters goal with this value. */
export const goalContract = {
  id: ExtensionId.make("test-goal"),
  commands: {},
  projection: {
    schema: Schema.Struct({
      revision: Schema.String,
      objective: Schema.String,
      state: Schema.Literals(["active", "paused", "complete", "blocked"]),
      stopReason: Schema.NullOr(Schema.String),
    }),
  },
};
/** A sample author proves controls require no Goal knowledge in Parakeet. */
export const probeClient = defineClientEntry(goalContract, {
  contribute: (view) => {
    const empty = {
      chips: [],
      panel: [],
      timeline: { cells: [], omitted: 0 },
      waiting: null,
    };
    if (view.status !== "running" || view.value === null) return empty;
    const value = view.value;
    return {
      ...empty,
      panel: [
        {
          id: "state",
          title: value.objective,
          detail: value.state,
          actions:
            value.state === "active" || value.state === "paused"
              ? [
                  {
                    id: "change",
                    label:
                      value.state === "active" ? "Pause goal" : "Resume goal",
                    input: {
                      action: value.state === "active" ? "pause" : "resume",
                    },
                  },
                ]
              : [],
        },
        ...(value.stopReason === null
          ? []
          : [{ id: "reason", title: value.stopReason }]),
      ],
    };
  },
});
export const probeClients = [probeClient];

export function goalSlots(goal: FixtureGoal | null): SessionExtensionSlots {
  return {
    [goalContract.id]: {
      status: "running",
      revision: "sha256:fixture",
      value: goal === null ? null : committedGoal(goal),
      catalog: {
        protocol: "whistle.catalog/v1",
        commands: [
          {
            id: "change",
            title: "Change state",
            category: "Probe",
            projections: { menu: {} },
          },
        ],
      },
    },
  };
}

/** A Session with no rostered extensions. */
export const noExtension: ShiitakeSession["extension"] = () => ({
  call: () => Promise.reject(new Error("No extension in this fixture")),
});

/** Route one Session's extension calls to fake per-command handlers. */
export function extensionCalls(
  handlers: Readonly<
    Record<string, Readonly<Record<string, (input: Json) => Promise<Json>>>>
  >,
): ShiitakeSession["extension"] {
  return (extensionId) => ({
    call: (command, input) => {
      const handler = handlers[extensionId]?.[command];
      return handler === undefined
        ? Promise.reject(new Error(`${extensionId} ${command} is unavailable`))
        : handler(input);
    },
  });
}
