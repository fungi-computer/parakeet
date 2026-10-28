import type { ReactNode } from "react";

import { CompletionMenu } from "./CompletionMenu.js";
import type { SlashCommandController } from "../commands/use-slash-commands.js";

/** Split a label into matched and unmatched runs (UTF-16 indices, like the matcher). */
function emphasize(label: string, matches: readonly number[]): ReactNode {
  if (matches.length === 0) return label;
  const marked = new Set(matches);
  const runs: { text: string; marked: boolean; start: number }[] = [];
  for (let index = 0; index < label.length; index += 1) {
    const isMarked = marked.has(index);
    const last = runs.at(-1);
    if (last?.marked === isMarked) last.text += label.charAt(index);
    else
      runs.push({ text: label.charAt(index), marked: isMarked, start: index });
  }
  return runs.map((run) =>
    run.marked ? (
      <mark key={run.start} className="parakeet-slash-match">
        {run.text}
      </mark>
    ) : (
      <span key={run.start}>{run.text}</span>
    ),
  );
}

/** Parakeet's slash adapter: maps its completion rows onto the shared menu. */
export function SlashMenu({
  slash,
  listId,
}: Readonly<{ slash: SlashCommandController; listId: string }>) {
  const { completion } = slash;
  if (completion.kind === "none") return null;
  const rows =
    completion.kind === "commands"
      ? completion.items.map((item) => ({
          key: item.command.commandId + item.label,
          label: emphasize(item.label, item.matches),
          detail:
            item.command.grammar === undefined
              ? item.command.title
              : `${item.command.title} · ${item.command.grammar.hint}`,
          keys: item.command.keys.join(", "),
          disabled: item.command.availability.status === "unavailable",
        }))
      : completion.items.map((item) => ({
          key: item.label,
          label: emphasize(item.label, item.matches),
          detail: item.word.description ?? "",
          keys: "",
          disabled: false,
        }));
  return (
    <CompletionMenu
      open={slash.open}
      rows={rows}
      selected={slash.selected}
      listId={listId}
      label="Commands"
      kind={completion.kind}
      hint={completion.kind === "arguments" ? completion.hint : undefined}
      onHighlight={slash.highlight}
      onChoose={slash.choose}
    />
  );
}
