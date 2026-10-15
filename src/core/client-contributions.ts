import {
  clientContributionSchemaV1,
  parseClientEntryV1,
  type ClientContributionV1,
  type ClientEntryV1,
} from "@fungi.computer/shiitake/client-entry";
import type { SessionExtensionSlots } from "@fungi.computer/shiitake/client";
import type { ExtensionSlotV0 } from "@fungi.computer/shiitake/extensions";
import { parseCatalog } from "@fungi.computer/whistle/catalog";
import * as Schema from "effect/Schema";

/** Decoded client data, still owned and ordered by its composition root. */
export type ClientContribution = Readonly<{
  /** Composition-root identity of the producing entry. */
  entryId: string;
  /** Strictly admitted presentation data for the current observed slot. */
  value: ClientContributionV1;
}>;

const decodeContribution = Schema.decodeUnknownSync(
  clientContributionSchemaV1,
  {
    onExcessProperty: "error",
  },
);

function actions(
  value: ClientContributionV1,
): readonly NonNullable<ClientContributionV1["waiting"]>["cancel"][] {
  return [
    ...value.panel.flatMap((row) => row.actions ?? []),
    ...value.timeline.cells.flatMap((cell) =>
      cell.rows.flatMap((row) => row.actions ?? []),
    ),
    ...(value.waiting === null ? [] : [value.waiting.cancel]),
  ];
}

function admitActions(
  value: ClientContributionV1,
  slot: ExtensionSlotV0 | undefined,
) {
  const declaredActions = actions(value);
  const inspections = value.panel.flatMap((row) =>
    row.inspection === undefined ? [] : [row.inspection],
  );
  if (declaredActions.length === 0 && inspections.length === 0) return;
  if (slot?.status !== "running" || slot.catalog === undefined)
    throw new Error("Client row actions require a running advertised catalog");
  const catalog = parseCatalog(slot.catalog);
  const ids = new Set(catalog.commands.map((command) => command.id));
  for (const inspection of inspections)
    if (!ids.has(inspection.commandId))
      throw new Error(
        `Client inspection ${inspection.commandId} is not advertised by its entry`,
      );
  for (const action of declaredActions)
    if (!ids.has(action.id))
      throw new Error(
        `Client row action ${action.id} is not advertised by its entry`,
      );
}

type ContributionAdmission =
  | { status: "admitted"; value: ClientContributionV1 }
  | { status: "failed"; error: Error };

function admitContribution(
  contribute: NonNullable<ClientEntryV1["contribute"]>,
  slot: ExtensionSlotV0 | undefined,
): ContributionAdmission {
  try {
    const value = decodeContribution(contribute(slot));
    admitActions(value, slot);
    return { status: "admitted", value };
  } catch (cause) {
    return {
      status: "failed",
      error:
        cause instanceof Error
          ? cause
          : new Error("Client contribution failed", { cause }),
    };
  }
}

/**
 * The selected-Session evaluation owner. Feed existing observed slots here;
 * renderers subscribe to admitted data and never evaluate an entry in render.
 */
export function createClientContributions(
  installed: readonly ClientEntryV1[],
  onError: (entryId: string, error: Error) => void,
) {
  const entries = installed.map((entry) => parseClientEntryV1(entry));
  if (new Set(entries.map((entry) => entry.id)).size !== entries.length)
    throw new Error("Duplicate client contribution entry");
  const previous = new Map<string, ExtensionSlotV0 | undefined>();
  const admitted = new Map<string, ClientContribution>();
  const failures = new Map<string, string>();
  const listeners = new Set<() => void>();
  let state: readonly ClientContribution[] = [];
  let disposed = false;
  return {
    snapshot: () => state,
    subscribe: (listener: () => void) => {
      if (disposed) return () => undefined;
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    update: (slots: SessionExtensionSlots) => {
      if (disposed) return;
      let changed = false;
      for (const entry of entries) {
        if (entry.contribute === undefined) continue;
        const slot = slots[entry.id];
        if (previous.has(entry.id) && previous.get(entry.id) === slot) continue;
        previous.set(entry.id, slot);
        admitted.delete(entry.id);
        changed = true;
        const result = admitContribution(entry.contribute, slot);
        if (result.status === "admitted") {
          admitted.set(entry.id, { entryId: entry.id, value: result.value });
          failures.delete(entry.id);
        } else {
          const { error } = result;
          const signature = `${error.name}: ${error.message}`;
          if (failures.get(entry.id) !== signature) onError(entry.id, error);
          failures.set(entry.id, signature);
        }
      }
      if (!changed) return;
      state = entries.flatMap((entry) => {
        const contribution = admitted.get(entry.id);
        return contribution === undefined ? [] : [contribution];
      });
      for (const listener of listeners) listener();
    },
    dispose: () => {
      disposed = true;
      previous.clear();
      failures.clear();
      admitted.clear();
      state = [];
      for (const listener of listeners) listener();
      listeners.clear();
    },
  };
}
