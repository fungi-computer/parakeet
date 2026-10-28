import {
  Popover,
  PopoverOption,
} from "@fungi.computer/caps/components/popover";
import type { KeyboardEvent, ReactNode } from "react";

/** One row of a completion menu. */
export type CompletionRow = Readonly<{
  key: string;
  label: ReactNode;
  detail?: string | undefined;
  /** Key hint shown at the row's end. */
  keys?: string | undefined;
  /** Decorative leading visual, such as a thumbnail. */
  media?: ReactNode;
  disabled?: boolean | undefined;
}>;

/** Stable id of one completion row, for `aria-activedescendant`. */
export function completionOptionId(listId: string, index: number): string {
  return `${listId}-${String(index)}`;
}

/** What a key press asks of an open completion menu. */
export type CompletionKeyAction =
  "next" | "previous" | "accept" | "dismiss" | null;

/**
 * The one reading of keys for a completion menu whose focus stays in the text
 * field: arrows move, Enter or Tab accept, Escape dismisses. Shift+Enter is
 * a newline, never an accept.
 */
export function completionKeyAction(
  event: Pick<KeyboardEvent, "key" | "shiftKey">,
): CompletionKeyAction {
  switch (event.key) {
    case "ArrowDown":
      return "next";
    case "ArrowUp":
      return "previous";
    case "Enter":
      return event.shiftKey ? null : "accept";
    case "Tab":
      return "accept";
    case "Escape":
      return "dismiss";
    default:
      return null;
  }
}

/** The ARIA attributes a combobox text field carries for an open menu. */
export function completionFieldProps(menu: {
  open: boolean;
  listId: string;
  selected: number;
}) {
  return {
    role: "combobox",
    "aria-autocomplete": "list",
    "aria-expanded": menu.open,
    "aria-controls": menu.open ? menu.listId : undefined,
    "aria-activedescendant": menu.open
      ? completionOptionId(menu.listId, menu.selected)
      : undefined,
  } as const;
}

/**
 * The shared completion menu: a Caps popover with listbox rows. It never
 * takes focus; the text field keeps typing and points at the highlighted row
 * with `aria-activedescendant`. Grove's slash commands and Prints' slash and
 * `@character` menus all draw it.
 */
export function CompletionMenu({
  open,
  rows,
  selected,
  listId,
  label,
  kind,
  hint,
  empty,
  onHighlight,
  onChoose,
}: Readonly<{
  open: boolean;
  rows: readonly CompletionRow[];
  selected: number;
  listId: string;
  /** Accessible name of the listbox. */
  label: string;
  kind: string;
  hint?: string | undefined;
  /** Shown instead of rows when there are none; omitted draws nothing. */
  empty?: string | undefined;
  onHighlight: (index: number) => void;
  onChoose: (index: number) => void;
}>) {
  return (
    <Popover open={open} side="top" data-parakeet-slash="">
      <div className="parakeet-slash-menu" data-kind={kind}>
        {hint === undefined ? null : (
          <p className="parakeet-slash-hint">{hint}</p>
        )}
        {rows.length === 0 ? (
          empty === undefined ? null : (
            <p className="parakeet-slash-hint">{empty}</p>
          )
        ) : (
          <div id={listId} role="listbox" aria-label={label}>
            {rows.map((row, index) => (
              <PopoverOption
                key={row.key}
                id={completionOptionId(listId, index)}
                active={index === selected}
                aria-disabled={row.disabled === true ? true : undefined}
                data-disabled={row.disabled === true}
                onMouseEnter={() => {
                  onHighlight(index);
                }}
                onClick={() => {
                  onChoose(index);
                }}
              >
                {row.media === undefined ? null : (
                  <span aria-hidden="true" className="parakeet-slash-media">
                    {row.media}
                  </span>
                )}
                <span className="parakeet-slash-label">{row.label}</span>
                <span className="parakeet-slash-detail">{row.detail}</span>
                {row.keys === undefined || row.keys.length === 0 ? null : (
                  <kbd className="parakeet-slash-keys">{row.keys}</kbd>
                )}
              </PopoverOption>
            ))}
          </div>
        )}
      </div>
    </Popover>
  );
}
