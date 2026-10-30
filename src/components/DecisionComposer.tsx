import { Checkbox } from "@fungi.computer/caps/components/checkbox";
import { KeycapButton } from "@fungi.computer/caps/components/keycap";
import { Input } from "@fungi.computer/caps/components/input";
import { Listbox } from "@fungi.computer/caps/components/listbox";
import { isImeComposing } from "@fungi.computer/caps/lib/ime";
import { useEffect, useRef, type KeyboardEvent } from "react";

import type {
  AwaitingItem,
  DecisionIntent,
  DecisionRowView,
  DecisionView,
} from "../core/awaiting-answer.js";
import { useDecision } from "../use-decision.js";
import { PromptHeader } from "./InteractionPanel.js";

/** Props for the decision that has taken over the composer. */
export type DecisionComposerProps = Readonly<{
  /** The waiting decision to answer. */
  item: AwaitingItem;
  /** One-based place among every waiting decision. */
  position: number;
  /** Every waiting decision. */
  total: number;
  /** Postpone the decision; it waits in the footer row. */
  onLater: () => void;
  /** The person was typing in the composer, so focus follows into the list. */
  takeFocus: boolean;
}>;

const kindNames = { question: "Question", approval: "Approval" } as const;

/**
 * The composer while the Agent waits on the person: the decision's rows,
 * an Other line, and Send / Later. It binds one waiting decision to its
 * reducer and draws the result.
 */
export function DecisionComposer({
  item,
  position,
  total,
  onLater,
  takeFocus,
}: DecisionComposerProps) {
  const decision = useDecision(item, { position, total, later: onLater });
  if (decision.view === undefined) return null;
  return (
    <DecisionPanel
      view={decision.view}
      dispatch={decision.dispatch}
      onLater={decision.later}
      takeFocus={takeFocus}
    />
  );
}

/**
 * Draw Parakeet's decision view with Caps parts and forward keys and clicks as
 * intents; the rules live in the reducer, so every surface answers alike.
 */
export function DecisionPanel({
  view,
  dispatch,
  onLater,
  takeFocus,
}: Readonly<{
  view: DecisionView;
  dispatch: (intent: DecisionIntent) => void;
  onLater: () => void;
  takeFocus: boolean;
}>) {
  const list = useRef<HTMLDivElement | null>(null);
  const input = useRef<HTMLInputElement | null>(null);
  const typing = view.phase === "other";
  const wasTyping = useRef(false);
  useEffect(() => {
    if (takeFocus) list.current?.focus();
  }, [takeFocus]);
  useEffect(() => {
    if (typing) input.current?.focus();
    else if (wasTyping.current && document.activeElement === input.current)
      list.current?.focus();
    wasTyping.current = typing;
  }, [typing]);
  const rows = view.rows;
  const field = view.other;
  const sending = view.phase === "sending";
  const act = (event: KeyboardEvent, handled: boolean, run: () => void) => {
    if (!handled) return false;
    event.preventDefault();
    run();
    return true;
  };
  const onListKey = (event: KeyboardEvent<HTMLDivElement>) => {
    // Keys typed in the Other row's field belong to the field.
    if (event.target instanceof HTMLInputElement) return;
    if (isImeComposing(event)) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const { key } = event;
    if (
      act(event, key === "ArrowDown", () => {
        dispatch({ type: "move", delta: 1 });
      }) ||
      act(event, key === "ArrowUp", () => {
        dispatch({ type: "move", delta: -1 });
      }) ||
      act(event, key === "Enter", () => {
        dispatch({ type: "enter" });
      }) ||
      act(event, key === " ", () => {
        dispatch({ type: "toggle" });
      }) ||
      act(event, key === "Escape", () => {
        dispatch({ type: "escape" });
      }) ||
      act(event, /^[1-9]$/u.test(key), () => {
        dispatch({ type: "pick", number: Number(key) });
      }) ||
      act(event, key.length === 1, () => {
        dispatch({ type: "append", text: key });
      })
    )
      return;
  };
  const onOtherKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (isImeComposing(event)) return;
    const { key } = event;
    if (
      act(event, key === "ArrowDown", () => {
        dispatch({ type: "move", delta: 1 });
      }) ||
      act(event, key === "ArrowUp", () => {
        dispatch({ type: "move", delta: -1 });
      }) ||
      act(event, key === "Enter", () => {
        dispatch({ type: "enter" });
      }) ||
      act(event, key === "Escape", () => {
        dispatch({ type: "escape" });
      })
    )
      return;
  };
  // A multiple decision's marker is a Caps check, not `[x]` text. The row
  // itself is the control: the option owns aria-selected and the click, so
  // the check is drawn for sight only.
  const check = (row: DecisionRowView) => (
    <span aria-hidden="true" className="pointer-events-none flex shrink-0">
      <Checkbox checked={row.toggled} readOnly tabIndex={-1} />
    </span>
  );
  const words = (row: DecisionRowView) => (
    <span className="flex flex-col">
      <span className={row.destructive ? "text-error" : undefined}>
        {view.multiple ? row.caption : row.text}
      </span>
      {row.description === undefined ? null : (
        <span className="text-sm opacity-70">{row.description}</span>
      )}
    </span>
  );
  const rowContent = (row: DecisionRowView) =>
    view.multiple ? (
      <span className="flex items-start gap-xs">
        {check(row)}
        {words(row)}
      </span>
    ) : (
      words(row)
    );
  const picked = rows.find((row) => row.highlighted);
  return (
    <div
      aria-label={view.label}
      className="parakeet-decision flex flex-col gap-xs p-sm"
      data-kind={view.kind}
      data-phase={view.phase}
      role="group"
    >
      <PromptHeader
        request={{
          message: view.title,
          summary: view.summary,
          facts: view.facts,
          body: view.body,
          bodyLabel: view.bodyLabel,
          details: view.details.length === 0 ? undefined : view.details,
        }}
        trailing={
          <span className="shrink-0 text-sm opacity-70">
            {view.counter ?? kindNames[view.kind]}
          </span>
        }
      />
      <Listbox<DecisionRowView>
        aria-label={view.title}
        className="parakeet-decision-list"
        getKey={(row) => String(row.index)}
        getLabel={(row) => row.label}
        isDisabled={() => sending}
        items={rows}
        rootRef={list}
        renderItem={(row) =>
          row.kind === "other" && field !== undefined ? (
            <span
              className="flex items-center gap-xs"
              data-highlight={row.highlighted || undefined}
              data-row="other"
            >
              {view.multiple ? check(row) : null}
              <span className="shrink-0">
                {view.multiple ? row.caption : row.text}
              </span>
              {row.highlighted || field.text !== "" ? (
                <Input
                  aria-label={field.label}
                  autoComplete="off"
                  disabled={sending}
                  maxLength={field.maxLength}
                  onChange={(event) => {
                    dispatch({ type: "type", text: event.target.value });
                  }}
                  onKeyDown={onOtherKey}
                  placeholder={field.placeholder}
                  ref={input}
                  value={field.text}
                />
              ) : null}
            </span>
          ) : (
            <span data-highlight={row.highlighted || undefined}>
              {rowContent(row)}
            </span>
          )
        }
        onKeyDown={onListKey}
        {...(view.multiple
          ? {
              multiple: true as const,
              value: rows
                .filter((row) => row.toggled)
                .map((row) => String(row.index)),
              onValueChange: (
                _value: string[],
                selected: DecisionRowView[],
              ) => {
                const clicked = rows.find(
                  (row) =>
                    selected.some((chosen) => chosen.index === row.index) !==
                    row.toggled,
                );
                if (clicked === undefined) return;
                dispatch({ type: "pick", number: clicked.index + 1 });
                if (clicked.kind === "option") dispatch({ type: "toggle" });
              },
            }
          : {
              value: picked === undefined ? null : String(picked.index),
              onValueChange: (
                _value: string | null,
                row: DecisionRowView | null,
              ) => {
                if (row !== null)
                  dispatch({ type: "pick", number: row.index + 1 });
              },
            })}
      />
      {view.status === undefined ? null : (
        <p
          className={
            view.status.tone === "error"
              ? "text-sm text-error"
              : "text-sm opacity-70"
          }
          role={view.status.tone === "error" ? "alert" : "status"}
        >
          {view.status.text}
        </p>
      )}
      <div className="parakeet-decision-actions">
        <KeycapButton label="Later" tone="neutral" onClick={onLater} />
        <KeycapButton
          disabled={!view.canSend}
          label="Send"
          onClick={() => {
            dispatch({ type: "enter" });
          }}
          tone="primary"
        />
      </div>
    </div>
  );
}
