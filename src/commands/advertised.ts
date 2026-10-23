import * as Schema from "effect/Schema";
import type { SessionExtensionSlots } from "@fungi.computer/shiitake/client";
import type {
  WhistleContributionLease,
  WhistleInteraction,
  WhistleRuntime,
} from "@fungi.computer/whistle";
import {
  catalogCommands,
  parseCatalog,
  parseCatalogStep,
} from "@fungi.computer/whistle/catalog";

import type { ParakeetSession } from "../session.js";
import type { ClientContribution } from "../core/client-contributions.js";

/** Why one advertised catalog could not become commands. */
export type AdvertisedCatalogError = Readonly<{
  /** The extension that advertised it. */
  extensionId: string;
  /** What was wrong. */
  message: string;
}>;

/** Live commands for every catalog a Session's extensions advertise. */
export type AdvertisedCommands = Readonly<{
  /** Apply the latest extension slots; changed catalogs replace their commands. */
  update: (slots: SessionExtensionSlots) => readonly AdvertisedCatalogError[];
  /** Withdraw every advertised command. */
  dispose: () => void;
}>;

const cancelled = Schema.is(Schema.Struct({ cancelled: Schema.Literal(true) }));
/** A bare invocation views; one carrying action arguments (`/plan clear`) acts. */
const bare = Schema.is(
  Schema.UndefinedOr(Schema.Record(Schema.String, Schema.Never)),
);

type Live = { catalog: string; lease: WhistleContributionLease };

/**
 * Turn each running extension's advertised `whistle.catalog/v1` catalog into
 * Whistle commands that call that extension's own door. The client names no
 * command: a new extension's catalog appears as new commands.
 * @param contributions - Current admitted panels that own unanswered prompts.
 */
export function advertisedCommands(
  runtime: Pick<WhistleRuntime, "contribute">,
  session: Pick<ParakeetSession, "extension">,
  contributions: () => readonly ClientContribution[],
  onInspect?: (entryId: string, commandId: string) => void,
): AdvertisedCommands {
  const live = new Map<string, Live>();
  const panelActions = (id: string, command: string) =>
    contributions()
      .find((entry) => entry.entryId === id)
      ?.value.panel.flatMap((row) => row.actions ?? [])
      .filter((action) => action.id === command) ?? [];
  const intent = (action: ReturnType<typeof panelActions>[number]) =>
    JSON.stringify([action.id, action.input ?? {}]);
  type Execution = {
    intents: readonly string[];
    withdrawn: boolean;
  };
  // A prompt borrows its panel intent, not the entire backend operation.
  // Once answered, its pending response must retain its ordinary lifetime.
  const prompts = new Set<{
    entryId: string;
    commandId: string;
    intents: readonly string[];
    execution: Execution;
    controller: AbortController;
  }>();
  const refreshPrompts = () => {
    for (const prompt of prompts) {
      const visible = new Set(
        panelActions(prompt.entryId, prompt.commandId).map(intent),
      );
      if (
        live.has(prompt.entryId) &&
        prompt.intents.every((id) => visible.has(id))
      )
        continue;
      prompt.execution.withdrawn = true;
      prompt.controller.abort();
    }
  };
  const withdraw = (id: string) => {
    live.get(id)?.lease.dispose();
    live.delete(id);
  };
  return {
    update: (slots) => {
      const errors: AdvertisedCatalogError[] = [];
      for (const id of live.keys()) {
        const slot = Object.hasOwn(slots, id) ? slots[id] : undefined;
        if (slot?.status !== "running" || slot.catalog === undefined)
          withdraw(id);
      }
      for (const [id, slot] of Object.entries(slots)) {
        if (slot.status !== "running" || slot.catalog === undefined) continue;
        const encoded = JSON.stringify(slot.catalog);
        if (live.get(id)?.catalog === encoded) continue;
        withdraw(id);
        try {
          const address = session.extension(id);
          const catalog = parseCatalog(slot.catalog);
          const commands = catalogCommands(catalog, (command, args) =>
            address.call(command, args),
          );
          live.set(id, {
            catalog: encoded,
            lease: runtime.contribute({
              sourceId: `extension:${id}`,
              namespace: id,
              commands: commands.map((command) => ({
                ...command,
                handler: async (input) => {
                  const actions = panelActions(id, command.id);
                  const execution: Execution = {
                    intents: actions.map(intent),
                    withdrawn: false,
                  };
                  // Invocation-local closures retain admitted identities only.
                  // A caller may share its signal and pass secret arguments.
                  const scopedCommand = catalogCommands(
                    catalog,
                    async (name, args) => {
                      const reply = await address.call(name, args);
                      const step = parseCatalogStep(reply);
                      if (step.type === "prompt") {
                        const selected = actions.filter((action) =>
                          Object.entries(action.input ?? {}).every(
                            ([key, value]) =>
                              JSON.stringify(
                                Object.hasOwn(step.next.arguments, key)
                                  ? step.next.arguments[key]
                                  : args[key],
                              ) === JSON.stringify(value),
                          ),
                        );
                        // Before selection, a chooser borrows all its candidates.
                        execution.intents = (
                          selected.length > 0 ? selected : actions
                        ).map(intent);
                      }
                      return reply;
                    },
                  ).find((candidate) => candidate.id === command.id);
                  if (scopedCommand === undefined)
                    throw new Error("The advertised command is unavailable");
                  let scoped: typeof input = input;
                  const interaction = input.interaction;
                  if (interaction !== undefined) {
                    const bound: WhistleInteraction = {
                      ...interaction,
                      prompt: (request, options) => {
                        const prompt = {
                          entryId: id,
                          commandId: command.id,
                          intents: execution.intents,
                          execution,
                          controller: new AbortController(),
                        };
                        prompts.add(prompt);
                        refreshPrompts();
                        return interaction
                          .prompt(request, {
                            signal:
                              options?.signal === undefined
                                ? prompt.controller.signal
                                : AbortSignal.any([
                                    options.signal,
                                    prompt.controller.signal,
                                  ]),
                          })
                          .finally(() => prompts.delete(prompt));
                      },
                    };
                    scoped = { ...scoped, interaction: bound };
                  }
                  let result: unknown;
                  try {
                    result = await scopedCommand.handler(scoped);
                  } catch (cause) {
                    if (execution.withdrawn) return { cancelled: true };
                    throw cause;
                  } finally {
                    for (const prompt of prompts)
                      if (prompt.execution === execution)
                        prompts.delete(prompt);
                  }
                  if (
                    input.origin !== "agent" &&
                    bare(input.arguments) &&
                    !cancelled(result) &&
                    !input.signal?.aborted &&
                    live.get(id)?.catalog === encoded
                  )
                    onInspect?.(id, command.id);
                  return result;
                },
              })),
            }),
          });
        } catch (cause) {
          errors.push({
            extensionId: id,
            message:
              cause instanceof Error
                ? cause.message
                : "The advertised catalog is invalid",
          });
        }
      }
      refreshPrompts();
      return errors;
    },
    dispose: () => {
      for (const id of live.keys()) withdraw(id);
      refreshPrompts();
    },
  };
}
