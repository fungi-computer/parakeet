import type {
  WhistleContribution,
  WhistleExecutionInput,
  WhistleRuntime,
} from "@fungi.computer/whistle";

/**
 * One category a host can account for in `/reload`, described by the owner
 * that already holds it. Nothing here caches, restarts or replaces anything:
 * `now` re-reads through the owner's own refresh, `next_turn` names a source
 * the owner already re-reads at the start of every turn, and `unsupported`
 * names a category with no safe re-read or replace lifecycle today.
 */
export type ReloadSource = Readonly<
  {
    /** The category the report names, such as "model catalog". */
    name: string;
  } & (
    | {
        /** Re-read now, while the command runs. */
        effect: "now";
        /** Re-read this category; a rejection is reported, never thrown. */
        reload: (signal: AbortSignal) => Promise<void>;
      }
    | {
        /** The owner already re-reads it at the start of every turn. */
        effect: "next_turn";
      }
    | {
        /** No safe re-read or replace lifecycle exists for it today. */
        effect: "unsupported";
        /** Why it cannot be reloaded, shown in the report. */
        reason: string;
      }
  )
>;

/** Where one `/reload` contribution comes from and what it can report. */
export type ReloadCommandOptions = Readonly<{
  /** Host source that owns the contribution lease. */
  sourceId: string;
  /** Namespace for the reload command. */
  namespace: string;
  /** Read at execution so the report names the categories mounted right now. */
  sources: () => readonly ReloadSource[];
}>;

function failure(cause: unknown): string {
  return cause instanceof Error && cause.message.length > 0
    ? cause.message.slice(0, 200)
    : "refresh failed";
}

/** Refresh what supports it and report every category honestly. */
export async function reloadSources(
  sources: readonly ReloadSource[],
  signal: AbortSignal,
): Promise<string> {
  const refreshed: string[] = [];
  const failed: string[] = [];
  const nextTurn: string[] = [];
  const unsupported: string[] = [];
  const reloadable: Extract<ReloadSource, { effect: "now" }>[] = [];
  for (const source of sources) {
    if (source.effect === "next_turn") nextTurn.push(source.name);
    else if (source.effect === "unsupported")
      unsupported.push(`${source.name} (${source.reason})`);
    else reloadable.push(source);
  }
  // Each refresh settles on its own: one failure is reported, never thrown,
  // and never stops the others. A synchronous throw settles as a rejection.
  const settled = await Promise.allSettled(
    reloadable.map((source) =>
      Promise.resolve().then(() => source.reload(signal)),
    ),
  );
  reloadable.forEach((source, index) => {
    const result = settled[index];
    if (result?.status === "fulfilled") refreshed.push(source.name);
    else failed.push(`${source.name} (${failure(result?.reason)})`);
  });
  const order = (names: string[]) =>
    names.sort((left, right) => left.localeCompare(right)).join(", ");
  const lines = [
    `Refreshed now: ${refreshed.length === 0 ? "nothing" : order(refreshed)}.`,
  ];
  if (failed.length > 0) lines.push(`Failed: ${order(failed)}.`);
  if (nextTurn.length > 0)
    lines.push(`Re-read at the next turn: ${order(nextTurn)}.`);
  if (unsupported.length > 0)
    lines.push(`Not reloadable: ${order(unsupported)}.`);
  lines.push("Active work and its captured context were not changed.");
  return lines.join("\n");
}

/** The shared `/reload` definition over host-described reload sources. */
export function reloadCommandDefinitions(
  options: Pick<ReloadCommandOptions, "sources">,
): WhistleContribution["commands"] {
  return [
    {
      id: "reload",
      title: "Reload",
      category: "Settings",
      description: "Re-read settings that support it",
      projections: {
        help: {},
        palette: {},
        slash: { aliases: ["reload"] },
      },
      handler: async ({ interaction }: WhistleExecutionInput) => {
        const report = await reloadSources(
          options.sources(),
          interaction?.signal ?? new AbortController().signal,
        );
        interaction?.notify({ type: "info", message: report });
        return report;
      },
    },
  ];
}

/** Contribute `/reload` to one Whistle host. */
export function contributeReloadCommand(
  commands: Pick<WhistleRuntime, "contribute">,
  options: ReloadCommandOptions,
) {
  return commands.contribute({
    sourceId: options.sourceId,
    namespace: options.namespace,
    commands: reloadCommandDefinitions(options),
  });
}
