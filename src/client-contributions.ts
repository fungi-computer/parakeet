import type { ClientContributionV1 } from "@fungi.computer/shiitake/client-entry";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  useClientContributions,
  useParakeetInteractions,
  useParakeetSession,
  useStatus,
} from "./conversation.js";
import type { ParakeetCommandRuntime } from "./commands/use-slash-commands.js";
import {
  createClientActions,
  type ClientActionState,
} from "./core/client-actions.js";

const emptyActions: ReadonlyMap<
  NonNullable<ClientContributionV1["waiting"]>["cancel"],
  ClientActionState
> = new Map();
const noActions = () => emptyActions;
const noSubscription = () => () => undefined;

/** Ordinary advertised actions over the current admitted rows and observation. */
export function useClientActions(commands: ParakeetCommandRuntime) {
  const contributions = useClientContributions();
  const { observation } = useStatus();
  const interactions = useParakeetInteractions();
  const session = useParakeetSession();
  const [owner, setOwner] = useState<ReturnType<typeof createClientActions>>();
  // This mutable input carries committed slots, never an optimistic projection.
  const input = useRef({ contributions, observation });
  input.current = { contributions, observation };
  useEffect(() => {
    const selected = createClientActions({
      commands,
      contributions: () => input.current.contributions,
      online: () => input.current.observation.status === "live",
      interactions,
    });
    setOwner(selected);
    return () => {
      selected.dispose();
    };
  }, [commands, interactions, session]);
  useEffect(() => {
    owner?.refresh();
  }, [owner, contributions]);
  const state = useSyncExternalStore(
    owner?.subscribe ?? noSubscription,
    owner?.snapshot ?? noActions,
    owner?.snapshot ?? noActions,
  );
  return {
    /** Current Session-owned state of admitted action intents. */
    state,
    /** Observation is live and this Session's action owner is attached. */
    enabled: owner !== undefined && observation.status === "live",
    /** Execute an admitted intent through its owning advertised command. */
    execute: (
      entryId: string,
      action: NonNullable<ClientContributionV1["waiting"]>["cancel"],
      waiting = false,
    ) => owner?.execute(entryId, action, waiting) ?? Promise.resolve(),
  };
}
