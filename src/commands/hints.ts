import type { KeyBindingRow, SlashCompletion } from "./slash.js";

/** One key hint: the keys, what they do, and how much it matters (0 first). */
export type KeyHint = Readonly<{
  /** Key label, e.g. `Enter`. */
  keys: string;
  /** What the key does. */
  label: string;
  /** Lower numbers survive narrow widths. */
  priority: number;
}>;

/** The composer's physical keys, which differ slightly between renderers. */
export type ComposerKeys = Readonly<{
  /** Key that inserts a newline, e.g. `Shift+Enter`. */
  newline?: string | undefined;
  /** Optional transcript scroll keys, e.g. `PgUp/PgDn`. */
  scroll?: string | undefined;
  /** Optional key that queues a follow-up during a run, e.g. `Tab`. */
  queue?: string | undefined;
}>;

/** What the composer is doing right now. */
export type ComposerHintContext = Readonly<{
  /** The current slash completion. */
  completion: SlashCompletion;
  /** Whether a run is active (Tab queues, Esc cancels). */
  busy: boolean;
  /** Live Whistle key bindings. */
  bindings: readonly KeyBindingRow[];
  /** The renderer's composer keys. */
  keys: ComposerKeys;
}>;

const cancelBindings = new Set(["Esc", "Ctrl+C"]);

/** Hints for the current composer state, in display order. */
export function composerHints(
  context: ComposerHintContext,
): readonly KeyHint[] {
  const { completion } = context;
  if (completion.kind === "commands" && completion.items.length > 0)
    return [
      { keys: "↑↓", label: "choose", priority: 1 },
      { keys: "Tab", label: "complete", priority: 0 },
      { keys: "Enter", label: "run", priority: 0 },
      { keys: "Esc", label: "dismiss", priority: 2 },
    ];
  if (completion.kind === "arguments")
    return completion.items.length > 0
      ? [
          { keys: "↑↓", label: "choose", priority: 1 },
          { keys: "Tab", label: "complete", priority: 0 },
          { keys: "Enter", label: "run", priority: 0 },
          { keys: "Esc", label: "dismiss", priority: 2 },
        ]
      : [
          { keys: "Enter", label: "run", priority: 0 },
          { keys: "Esc", label: "dismiss", priority: 2 },
        ];
  const hints: KeyHint[] = [{ keys: "Enter", label: "send", priority: 0 }];
  if (context.busy && context.keys.queue !== undefined)
    hints.push({ keys: context.keys.queue, label: "queue", priority: 0 });
  if (context.keys.newline !== undefined)
    hints.push({ keys: context.keys.newline, label: "newline", priority: 1 });
  if (context.keys.scroll !== undefined)
    hints.push({ keys: context.keys.scroll, label: "scroll", priority: 2 });
  for (const binding of context.bindings) {
    const cancel = binding.keys
      .split(", ")
      .some((key) => cancelBindings.has(key));
    if (cancel && !context.busy) continue;
    hints.push({
      keys: binding.keys,
      label: binding.title.toLocaleLowerCase(),
      priority: cancel ? 0 : 3,
    });
  }
  hints.push({ keys: "/", label: "commands", priority: 4 });
  return hints;
}

const separator = " · ";

/** One line of hints. */
export function formatHints(hints: readonly KeyHint[]): string {
  return hints.map((hint) => `${hint.keys} ${hint.label}`).join(separator);
}

/** Keep the most important hints that fit `width` characters, in order. */
export function fitHints(
  hints: readonly KeyHint[],
  width: number,
): readonly KeyHint[] {
  const kept = new Set<KeyHint>();
  let used = 0;
  const byPriority = [...hints].sort(
    (left, right) => left.priority - right.priority,
  );
  for (const hint of byPriority) {
    const length =
      hint.keys.length + 1 + hint.label.length + (kept.size === 0 ? 0 : 3);
    if (used + length > width) continue;
    kept.add(hint);
    used += length;
  }
  return hints.filter((hint) => kept.has(hint));
}
