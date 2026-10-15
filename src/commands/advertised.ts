import * as Schema from "effect/Schema";
import type { SessionExtensionSlots } from "@fungi.computer/shiitake/client";
import type {
  WhistleContributionLease,
  WhistleRuntime,
} from "@fungi.computer/whistle";
import { catalogCommands, parseCatalog } from "@fungi.computer/whistle/catalog";

import type { ParakeetSession } from "../session.js";

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
 */
export function advertisedCommands(
  runtime: Pick<WhistleRuntime, "contribute">,
  session: Pick<ParakeetSession, "extension">,
  onInspect?: (entryId: string, commandId: string) => void,
): AdvertisedCommands {
  const live = new Map<string, Live>();
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
          const commands = catalogCommands(
            parseCatalog(slot.catalog),
            (command, args) => address.call(command, args),
          );
          live.set(id, {
            catalog: encoded,
            lease: runtime.contribute({
              sourceId: `extension:${id}`,
              namespace: id,
              commands: commands.map((command) => ({
                ...command,
                handler: async (input) => {
                  const result = await command.handler(input);
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
      return errors;
    },
    dispose: () => {
      for (const id of live.keys()) withdraw(id);
    },
  };
}
