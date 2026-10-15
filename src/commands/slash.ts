import type {
  WhistleAvailability,
  WhistleJsonObject,
  WhistleSlashArguments,
  WhistleSlashWord,
  WhistleSnapshot,
} from "@fungi.computer/whistle";

/** One slash command as every Parakeet renderer lists it. */
export type SlashCommand = Readonly<{
  /** The alias typed after `/`. */
  alias: string;
  /** Canonical Whistle command identity. */
  commandId: string;
  /** Human-facing title. */
  title: string;
  /** Optional longer explanation. */
  description?: string | undefined;
  /** Human-facing category. */
  category: string;
  /** Surface order supplied by the command owner. */
  order: number;
  /** The argument grammar, when the command takes text after its alias. */
  grammar?: WhistleSlashArguments | undefined;
  /** Key labels bound to the same command, e.g. `Ctrl+O`. */
  keys: readonly string[];
  /** Unavailable commands stay listed with their reason. */
  availability: WhistleAvailability;
}>;

/** One key binding as help and hint surfaces list it. */
export type KeyBindingRow = Readonly<{
  /** Canonical Whistle command identity. */
  commandId: string;
  /** Human key label, e.g. `Ctrl+O`. */
  keys: string;
  /** What the key does. */
  title: string;
  /** Surface order supplied by the command owner. */
  order: number;
}>;

/** Human key labels from Whistle bindings, with the platform's modifier name. */
export function keyLabel(
  binding: string,
  mac = /Mac|iPhone|iPad/u.test(globalThis.navigator.userAgent),
): string {
  return binding
    .split(" ")
    .map((chord, index) => {
      if (chord === "<leader>") return "Ctrl K";
      if (index > 0 && binding.startsWith("<leader> ")) return chord;
      const parts = chord
        .split("+")
        .map((part) =>
          part === "mod"
            ? mac
              ? "⌘"
              : "Ctrl"
            : part === "escape"
              ? "Esc"
              : part.length === 1
                ? part.toUpperCase()
                : part.charAt(0).toUpperCase() + part.slice(1),
        );
      return parts.join(chord === "ctrl+k" || chord === "mod+k" ? " " : "+");
    })
    .join(" ");
}

/** Every slash alias in the live graph, with the keys bound to its command. */
export function slashRegistry(
  snapshot: WhistleSnapshot,
): readonly SlashCommand[] {
  const keys = new Map<string, string[]>();
  for (const row of snapshot.bindings)
    keys.set(row.commandId, [
      ...(keys.get(row.commandId) ?? []),
      keyLabel(row.binding),
    ]);
  return snapshot.slash.map((row) => ({
    alias: row.alias,
    commandId: row.commandId,
    title: row.title,
    description: row.description,
    category: row.category,
    order: row.order,
    grammar: row.arguments,
    keys: keys.get(row.commandId) ?? [],
    availability: row.availability,
  }));
}

/** Every bound key in the live graph, grouped by command. */
export function keyBindings(
  snapshot: WhistleSnapshot,
): readonly KeyBindingRow[] {
  const rows = new Map<string, KeyBindingRow>();
  for (const row of snapshot.bindings) {
    const current = rows.get(row.commandId);
    rows.set(row.commandId, {
      commandId: row.commandId,
      keys:
        current === undefined
          ? keyLabel(row.binding)
          : `${current.keys}, ${keyLabel(row.binding)}`,
      title: row.title,
      order: current?.order ?? row.order,
    });
  }
  return [...rows.values()];
}

/** How one composer draft maps to a command. */
export type SlashParse =
  | Readonly<{
      /** Not a command: send it as a prompt. */
      kind: "prompt";
    }>
  | Readonly<{
      /** Run this command. */
      kind: "command";
      /** The command. */
      command: SlashCommand;
      /** Arguments decoded by the command's grammar; absent for a bare alias. */
      arguments?: WhistleJsonObject | undefined;
      /** Field that must receive a stable per-draft request id. */
      requestIdField?: string | undefined;
    }>
  | Readonly<{
      /** Refuse the draft without running anything. */
      kind: "invalid";
      /** Why, for the human. */
      message: string;
    }>;

function usage(command: SlashCommand): string {
  const words = command.grammar?.words?.map(({ word }) => word) ?? [];
  if (command.grammar === undefined)
    return `/${command.alias} takes no arguments.`;
  if (command.grammar.text !== undefined)
    return `Use /${command.alias} ${command.grammar.hint}.`;
  return `Use /${command.alias} ${words.join(" or ")}.`;
}

/** Parse one draft against the registry; only a leading `/` names a command. */
export function parseSlashDraft(
  registry: readonly SlashCommand[],
  draft: string,
): SlashParse {
  if (!draft.startsWith("/")) return { kind: "prompt" };
  const match = /^\/(\S*)(?:\s+([\s\S]*))?$/u.exec(draft.trimEnd());
  const alias = match?.[1] ?? "";
  const rest = (match?.[2] ?? "").trim();
  const command = registry.find((candidate) => candidate.alias === alias);
  if (command === undefined)
    return {
      kind: "invalid",
      message: `Unsupported command: /${alias}. Use /help for available commands.`,
    };
  if (rest.length === 0) return { kind: "command", command };
  const grammar = command.grammar;
  const word = grammar?.words?.find((candidate) => candidate.word === rest);
  if (word !== undefined)
    return { kind: "command", command, arguments: word.arguments };
  if (grammar?.text === undefined)
    return { kind: "invalid", message: usage(command) };
  return {
    kind: "command",
    command,
    arguments: { ...grammar.text.arguments, [grammar.text.field]: rest },
    requestIdField: grammar.text.requestIdField,
  };
}

/** One command offered while the alias is being typed. */
export type SlashCommandItem = Readonly<{
  /** The command. */
  command: SlashCommand;
  /** `/alias`. */
  label: string;
  /** Indices of `label` characters that matched the query, for emphasis. */
  matches: readonly number[];
  /** Draft text after accepting this item. */
  insert: string;
}>;

/** One argument word offered after the alias. */
export type SlashWordItem = Readonly<{
  /** The word. */
  word: WhistleSlashWord;
  /** The word as displayed. */
  label: string;
  /** Indices of `label` characters that matched the query. */
  matches: readonly number[];
  /** Draft text after accepting this item. */
  insert: string;
}>;

/** What a composer shows for the current draft. */
export type SlashCompletion =
  | Readonly<{
      /** Nothing to complete. */
      kind: "none";
    }>
  | Readonly<{
      /** Choosing a command. */
      kind: "commands";
      /** Text typed after `/`. */
      query: string;
      /** Ranked matches, best first. */
      items: readonly SlashCommandItem[];
    }>
  | Readonly<{
      /** Typing a command's arguments. */
      kind: "arguments";
      /** The command whose arguments are being typed. */
      command: SlashCommand;
      /** Text typed after the alias. */
      query: string;
      /** Usage hint, e.g. `/goal <objective>`. */
      hint: string;
      /** Ranked matching words, best first. */
      items: readonly SlashWordItem[];
    }>;

/** How well one candidate matched a query; lower tiers and spreads rank first. */
export type FuzzyMatch = Readonly<{
  /** 0 prefix, 1 word start, 2 substring, 3 in-order subsequence. */
  tier: number;
  /** Characters skipped within the tier (distance or gaps). */
  spread: number;
  /** Candidate indices that matched the query, for emphasis. */
  indices: number[];
}>;
type Match = FuzzyMatch;

/**
 * Fuzzy match: a prefix beats a word start beats a substring beats an
 * in-order subsequence; tighter subsequences rank first.
 */
export function fuzzyMatch(
  candidate: string,
  query: string,
): FuzzyMatch | undefined {
  const text = candidate.toLocaleLowerCase();
  const needle = query.toLocaleLowerCase();
  if (needle.length === 0) return { tier: 0, spread: 0, indices: [] };
  const range = (start: number) =>
    Array.from({ length: needle.length }, (_, offset) => start + offset);
  if (text.startsWith(needle))
    return { tier: 0, spread: text.length - needle.length, indices: range(0) };
  const wordStart = text.search(
    new RegExp(
      `[-_\\s]${needle.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&")}`,
      "u",
    ),
  );
  if (wordStart >= 0)
    return { tier: 1, spread: wordStart, indices: range(wordStart + 1) };
  const inside = text.indexOf(needle);
  if (inside >= 0) return { tier: 2, spread: inside, indices: range(inside) };
  const indices: number[] = [];
  let from = 0;
  for (const character of needle) {
    const found = text.indexOf(character, from);
    if (found < 0) return undefined;
    indices.push(found);
    from = found + 1;
  }
  const first = indices[0] ?? 0;
  const last = indices.at(-1) ?? 0;
  return { tier: 3, spread: last - first - needle.length + 1, indices };
}

function rank<T>(
  entries: readonly T[],
  text: (entry: T) => string,
  query: string,
  order: (entry: T) => number,
): readonly Readonly<{ entry: T; indices: readonly number[] }>[] {
  return entries
    .map((entry) => ({ entry, match: fuzzyMatch(text(entry), query) }))
    .filter(
      (scored): scored is { entry: T; match: Match } =>
        scored.match !== undefined,
    )
    .sort(
      (left, right) =>
        left.match.tier - right.match.tier ||
        left.match.spread - right.match.spread ||
        order(left.entry) - order(right.entry) ||
        text(left.entry).localeCompare(text(right.entry)),
    )
    .map(({ entry, match }) => ({ entry, indices: match.indices }));
}

/** Rank completions for one draft; renderers draw exactly these rows. */
export function completeSlash(
  registry: readonly SlashCommand[],
  draft: string,
  options: Readonly<{
    /** Category offered for a bare `/`; conversations use `Conversation`. */
    idleCategory?: string;
  }> = {},
): SlashCompletion {
  if (!draft.startsWith("/") || draft.includes("\n")) return { kind: "none" };
  const space = draft.search(/\s/u);
  if (space < 0) {
    const query = draft.slice(1);
    const items = rank(
      registry.filter(
        (command) =>
          command.availability.status === "available" &&
          (query.length === 0
            ? command.category === (options.idleCategory ?? "Conversation")
            : command.category !== "Advanced" ||
              command.alias
                .toLocaleLowerCase()
                .startsWith(query.toLocaleLowerCase())),
      ),
      (command) => command.alias,
      query,
      (command) => command.order,
    ).map(({ entry, indices }) => ({
      command: entry,
      label: `/${entry.alias}`,
      matches: indices.map((index) => index + 1),
      insert:
        entry.grammar === undefined ? `/${entry.alias}` : `/${entry.alias} `,
    }));
    return { kind: "commands", query, items };
  }
  const alias = draft.slice(1, space);
  const command = registry.find((candidate) => candidate.alias === alias);
  if (
    command?.grammar === undefined ||
    command.availability.status !== "available"
  )
    return { kind: "none" };
  const query = draft.slice(space).trimStart();
  // Words match by prefix only, so free text is never mistaken for a word.
  const words = query.includes(" ") ? [] : (command.grammar.words ?? []);
  const items = words
    .filter((word) =>
      word.word.toLocaleLowerCase().startsWith(query.toLocaleLowerCase()),
    )
    .map((word) => ({
      word,
      label: word.word,
      matches: Array.from({ length: query.length }, (_, index) => index),
      insert: `/${alias} ${word.word}`,
    }));
  return {
    kind: "arguments",
    command,
    query,
    hint: `/${alias} ${command.grammar.hint}`,
    items,
  };
}
