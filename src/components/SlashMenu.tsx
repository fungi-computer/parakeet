import { PopoverOption } from "@fungi.computer/caps/components/popover";
import type { ReactNode } from "react";

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

/** Stable id of one slash row, for `aria-activedescendant`. */
export function slashOptionId(listId: string, index: number): string {
  return `${listId}-${String(index)}`;
}

/** The browser slash menu: draws Parakeet's completion rows, nothing more. */
export function SlashMenu({
  slash,
  listId,
}: Readonly<{ slash: SlashCommandController; listId: string }>) {
  const { completion, selected } = slash;
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
    <div className="parakeet-slash-menu" data-kind={completion.kind}>
      {completion.kind === "arguments" ? (
        <p className="parakeet-slash-hint">{completion.hint}</p>
      ) : null}
      {rows.length === 0 ? null : (
        <div id={listId} role="listbox" aria-label="Commands">
          {rows.map((row, index) => (
            <PopoverOption
              key={row.key}
              id={slashOptionId(listId, index)}
              active={index === selected}
              aria-disabled={row.disabled || undefined}
              data-disabled={row.disabled}
              onMouseEnter={() => {
                slash.highlight(index);
              }}
              onClick={() => {
                slash.choose(index);
              }}
            >
              <span className="parakeet-slash-label">{row.label}</span>
              <span className="parakeet-slash-detail">{row.detail}</span>
              {row.keys.length === 0 ? null : (
                <kbd className="parakeet-slash-keys">{row.keys}</kbd>
              )}
            </PopoverOption>
          ))}
        </div>
      )}
    </div>
  );
}
