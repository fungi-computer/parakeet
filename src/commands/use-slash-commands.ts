import type { PromptDelivery } from "@fungi.computer/shiitake/client";
import type {
  WhistleExecutionOrigin,
  WhistleExecutionOutcome,
  WhistleRuntime,
} from "@fungi.computer/whistle";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import {
  useComposer,
  useClientContributions,
  useExtensionSlots,
  useParakeetSession,
  useParakeetInteractions,
} from "../conversation.js";
import { advertisedCommands } from "./advertised.js";
import { parakeetBuiltinCommands } from "./builtins.js";
import { composerHints, type ComposerKeys, type KeyHint } from "./hints.js";
import {
  type ParakeetInteractions,
  type ParakeetInteractionState,
} from "./interactions.js";
import { runSlashDraft } from "./run.js";
import {
  completeSlash,
  keyBindings,
  slashRegistry,
  type SlashCompletion,
} from "./slash.js";

/** The Whistle runtime a Parakeet composer runs commands through. */
export type ParakeetCommandRuntime = Pick<
  WhistleRuntime,
  "contribute" | "snapshot" | "subscribe" | "execute" | "present"
>;

/** Inputs for one composer's command controller. */
export type SlashCommandOptions = Readonly<{
  /** Disable command registration, completion and execution for visitor conversations. */
  enabled?: boolean;
  /** The runtime holding host, built-in and advertised commands. */
  commands: ParakeetCommandRuntime;
  /** Execution origin for commands typed in this composer. */
  origin: WhistleExecutionOrigin;
  /** The renderer's composer keys, for hints. */
  keys: ComposerKeys;
  /** Whether a run is active. */
  busy: boolean;
  /** Host-owned interaction store shared with client activity observers. */
  interactionStore?: ParakeetInteractions | undefined;
  /** Use the host palette for /help instead of a separate slash-command list. */
  showCommands?: (() => void | Promise<void>) | undefined;
}>;

/** Everything a renderer needs to draw and drive slash commands. */
export type SlashCommandController = Readonly<{
  /** What to show for the current draft. */
  completion: SlashCompletion;
  /** Whether the completion popover is visible. */
  open: boolean;
  /** Index of the highlighted completion row. */
  selected: number;
  /** Key hints for the current state, most useful first when fitted. */
  hints: readonly KeyHint[];
  /** The command conversation state. */
  interactions: ParakeetInteractionState;
  /** The conversation store, for closing and retrying dialogs. */
  store: ParakeetInteractions;
  /** Move the highlight; false when no list is open. */
  move: (delta: -1 | 1) => boolean;
  /** Highlight one row (pointer hover). */
  highlight: (index: number) => void;
  /** Complete the highlighted row into the draft; false when nothing to complete. */
  complete: () => boolean;
  /** Dismiss the open interaction, then the completion, then the notice. */
  dismiss: () => boolean;
  /** Run the highlighted row, a command draft, or send a prompt. */
  submit: (delivery?: PromptDelivery) => void;
  /** Run one completion row (pointer choice). */
  choose: (index: number) => void;
}>;

function failureMessage(
  outcome: WhistleExecutionOutcome | undefined,
): string | undefined {
  if (outcome === undefined || outcome.status === "handled") return undefined;
  if (outcome.status === "failed") return outcome.error.message;
  if (outcome.status === "unavailable") return outcome.reason;
  return `Command ${outcome.status}`;
}

/**
 * The one slash-command controller behind every Parakeet composer. It owns
 * the registry, completion, hints, execution and conversations; renderers
 * only draw its state and forward keys.
 */
export function useSlashCommands(
  options: SlashCommandOptions,
): SlashCommandController {
  const { commands, origin } = options;
  const enabled = options.enabled ?? true;
  const session = useParakeetSession();
  const composer = useComposer();
  const slots = useExtensionSlots();
  const contributions = useClientContributions();
  const contributionsRef = useRef(contributions);
  contributionsRef.current = contributions;
  const scopedInteractions = useParakeetInteractions();
  const store = useMemo(
    () => options.interactionStore ?? scopedInteractions,
    [options.interactionStore, scopedInteractions],
  );
  const interactions = useSyncExternalStore(
    store.subscribe,
    store.snapshot,
    store.snapshot,
  );
  useEffect(() => {
    const inspection = interactions.inspection;
    if (
      inspection !== undefined &&
      !contributions.some(
        (entry) =>
          entry.entryId === inspection.entryId &&
          entry.value.panel.some(
            (row) =>
              row.id === inspection.rowId && row.inspection !== undefined,
          ),
      )
    )
      store.inspect(undefined);
  }, [contributions, interactions.inspection, store]);
  const snapshot = useSyncExternalStore(
    commands.subscribe,
    commands.snapshot,
    commands.snapshot,
  );
  const composerRef = useRef(composer);
  composerRef.current = composer;
  const showCommandsRef = useRef(options.showCommands);
  showCommandsRef.current = options.showCommands;
  const hasCommandPalette = options.showCommands !== undefined;

  useEffect(() => {
    if (!enabled) return undefined;
    return store.attach(commands.present);
  }, [commands, enabled, store]);
  useEffect(() => {
    if (!enabled) return;
    const lease = commands.contribute({
      sourceId: "parakeet",
      namespace: "parakeet",
      commands: parakeetBuiltinCommands(commands, {
        showCommands: hasCommandPalette
          ? () => showCommandsRef.current?.()
          : undefined,
        clear: () => {
          composerRef.current.setDraft("");
          store.report(undefined);
        },
      }),
    });
    return () => {
      lease.dispose();
    };
  }, [commands, enabled, store, hasCommandPalette]);
  const advertised = useMemo(
    () =>
      advertisedCommands(commands, session, (entryId, commandId) => {
        const row = contributionsRef.current
          .find((entry) => entry.entryId === entryId)
          ?.value.panel.find((row) => row.inspection?.commandId === commandId);
        if (row !== undefined) store.inspect({ entryId, rowId: row.id });
      }),
    [commands, session, store],
  );
  useEffect(
    () => () => {
      advertised.dispose();
    },
    [advertised],
  );
  useEffect(() => {
    if (!enabled) {
      advertised.dispose();
      return;
    }
    const [error] = advertised.update(slots);
    if (error !== undefined)
      store.report({
        tone: "error",
        message: `${error.extensionId} commands are unavailable: ${error.message}`,
      });
  }, [advertised, enabled, slots, store]);

  const registry = useMemo(() => slashRegistry(snapshot), [snapshot]);
  const [dismissed, setDismissed] = useState<string>();
  const [highlighted, setHighlighted] = useState({ draft: "", index: 0 });
  const draft = composer.draft;
  const completion: SlashCompletion =
    !enabled || dismissed === draft || interactions.open !== undefined
      ? { kind: "none" }
      : completeSlash(registry, draft);
  const rowCount = completion.kind === "none" ? 0 : completion.items.length;
  const open =
    completion.kind === "arguments" ||
    (completion.kind === "commands" && rowCount > 0);
  const selected =
    highlighted.draft === draft
      ? Math.min(highlighted.index, Math.max(0, rowCount - 1))
      : 0;
  const hints = composerHints({
    completion,
    busy: options.busy,
    bindings: keyBindings(snapshot),
    keys: options.keys,
  });

  const run = useCallback(
    (delivery: PromptDelivery, replacement?: string) => {
      const current = composerRef.current;
      if (!enabled) {
        current.send(delivery);
        return;
      }
      if (replacement !== undefined) current.setDraft(replacement);
      const submitted = replacement ?? current.draft;
      store.report(undefined);
      setDismissed(submitted);
      void current
        .submitCommand((captured) =>
          runSlashDraft(
            captured,
            commands,
            () => {
              current.send(delivery);
            },
            origin,
          ),
        )
        .then((outcome) => {
          const message = failureMessage(outcome);
          if (
            message !== undefined &&
            store.snapshot().open === undefined &&
            store.lastEnd() !== "cancelled"
          )
            store.report({
              tone: "error",
              message: `${submitted}: ${message}`,
            });
        });
    },
    [commands, enabled, origin, store],
  );
  const insertAt = (index: number): string | undefined => {
    if (completion.kind === "commands") return completion.items[index]?.insert;
    if (completion.kind === "arguments") return completion.items[index]?.insert;
    return undefined;
  };
  const choose = (index: number) => {
    const insert = insertAt(index);
    if (insert === undefined) return;
    run(options.busy ? "followUp" : "steer", insert.trimEnd());
  };
  return {
    completion,
    open,
    selected,
    hints,
    interactions,
    store,
    move: (delta) => {
      if (rowCount === 0) return false;
      setHighlighted({
        draft,
        index: (selected + delta + rowCount) % rowCount,
      });
      return true;
    },
    highlight: (index) => {
      setHighlighted({ draft, index });
    },
    complete: () => {
      const insert = insertAt(selected);
      if (insert === undefined) return false;
      composer.setDraft(insert);
      return true;
    },
    dismiss: () => {
      if (interactions.open !== undefined) {
        store.close();
        return true;
      }
      if (interactions.inspection !== undefined) {
        store.inspect(undefined);
        return true;
      }
      if (open) {
        setDismissed(draft);
        return true;
      }
      if (interactions.notice !== undefined) {
        store.report(undefined);
        return true;
      }
      return false;
    },
    submit: (delivery = options.busy ? "followUp" : "steer") => {
      // A bare `/alias ` runs the alias; a typed word prefix runs its word.
      const accepts =
        completion.kind === "commands" ||
        (completion.kind === "arguments" && completion.query.length > 0);
      const insert = accepts && rowCount > 0 ? insertAt(selected) : undefined;
      run(delivery, insert?.trimEnd());
    },
    choose,
  };
}
