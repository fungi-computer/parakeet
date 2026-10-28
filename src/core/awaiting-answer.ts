import type { WhistlePromptOf } from "@fungi.computer/whistle/wire";
import type { WhistleInteractionHost } from "@fungi.computer/whistle/interaction";

import type { KeyHint } from "../commands/hints.js";

/** What the Agent needs from the person. */
export type AwaitingKind = "question" | "approval";

/**
 * One decision waiting for the person. Its `host` is the renderer-neutral
 * conversation that holds the current `decision` prompt and takes the answer.
 */
export type AwaitingItem = Readonly<{
  /** Stable identity, kept while the item waits. */
  key: string;
  /** Question or tool approval; both share one queue. */
  kind: AwaitingKind;
  /** When it joined the queue; items stay in arrival order. */
  arrivedAt: number;
  /** The conversation to draw and answer. */
  host: WhistleInteractionHost;
}>;

/** Which item the composer shows and where it stands among all of them. */
export type AwaitingQueue = Readonly<{
  /** Every waiting item in arrival order. */
  items: readonly AwaitingItem[];
  /** The first item not postponed with Later, in arrival order. */
  current?: AwaitingItem | undefined;
  /** One-based place of `current` among every waiting item. */
  position: number;
  /** Every waiting item, questions and approvals together. */
  total: number;
}>;

/**
 * Order the items by arrival and pick the one the composer shows. A postponed
 * item leaves the composer but stays counted: it is the footer row.
 */
export function awaitingQueue(
  items: readonly AwaitingItem[],
  later: ReadonlySet<string>,
): AwaitingQueue {
  const ordered = items
    .map((item, index) => ({ item, index }))
    .sort(
      (left, right) =>
        left.item.arrivedAt - right.item.arrivedAt || left.index - right.index,
    )
    .map(({ item }) => item);
  const current = ordered.find((item) => !later.has(item.key));
  return {
    items: ordered,
    current,
    position: current === undefined ? 0 : ordered.indexOf(current) + 1,
    total: ordered.length,
  };
}

/**
 * The item that owns the composer right now. An empty draft is taken over;
 * a draft with text is never, unless the person asked for the decision.
 */
export function awaitingTakeover(
  awaiting: AwaitingQueue & Readonly<{ forced: boolean }>,
  draft: string,
): AwaitingItem | undefined {
  return draft === "" || awaiting.forced ? awaiting.current : undefined;
}

/** The decision prompt both renderers draw. */
export type DecisionPrompt = WhistlePromptOf<"decision">;

/** Where one decision is in its short life. */
export type DecisionPhase =
  "choose" | "other" | "confirm" | "sending" | "refused";

/** Everything the reducer remembers about one decision prompt. */
export type DecisionState = Readonly<{
  /** Highlighted row: an option, or the Other row after the last option. */
  highlight: number;
  /** Option values toggled so far (multiple decisions only). */
  toggled: ReadonlySet<string>;
  /** Text typed on the Other row; kept when the person leaves the row. */
  other: string;
  /** What the person is doing now. */
  phase: DecisionPhase;
  /** Why the last answer came back, while `phase` is `refused`. */
  refusal?: string | undefined;
  /** The long text and details replace the rows. */
  details: boolean;
}>;

/** What the person did, independent of which key or click did it. */
export type DecisionIntent =
  | Readonly<{
      /** Step the highlight, wrapping at either end. */
      type: "move";
      /** Which way. */
      delta: -1 | 1;
    }>
  | Readonly<{
      /** Move the highlight to a numbered row; never answers. */
      type: "pick";
      /** One-based row number, the Other row last. */
      number: number;
    }>
  | Readonly<{
      /** Toggle the highlighted option of a multiple decision. */
      type: "toggle";
    }>
  | Readonly<{
      /** Replace the Other line's text, e.g. from a field. */
      type: "type";
      /** The whole text now. */
      text: string;
    }>
  | Readonly<{
      /** Add typed characters to the Other line and move onto it. */
      type: "append";
      /** The characters. */
      text: string;
    }>
  | Readonly<{
      /** Confirm: the one way to answer. */
      type: "enter";
    }>
  | Readonly<{
      /** Step back one level; from the option list it postpones the decision. */
      type: "escape";
    }>
  | Readonly<{
      /** Show or hide the long text and details. */
      type: "details";
    }>
  | Readonly<{
      /** The owner of the decision refused the answer. */
      type: "refused";
      /** Why, in words for the person. */
      message: string;
    }>;

/** What the owner of the decision must now do. */
export type DecisionEffect =
  | Readonly<{
      /** Send this answer. */
      type: "answer";
      /** The option values picked. */
      selected: string[];
      /** What the person wrote on the Other line, if anything. */
      text?: string;
    }>
  | Readonly<{
      /** Postpone: leave the composer, stay waiting, answer nothing. */
      type: "later";
    }>
  | Readonly<{
      /** The reducer stepped back one level; nothing for the owner to do. */
      type: "back";
    }>;

/** The next state, and what the decision's owner must do about the intent. */
export type DecisionOutcome = Readonly<{
  /** The state to keep. */
  state: DecisionState;
  /** What the owner must do now, when anything. */
  effect?: DecisionEffect;
}>;

/** The state a decision starts in. */
export function initialDecisionState(): DecisionState {
  return {
    highlight: 0,
    toggled: new Set(),
    other: "",
    phase: "choose",
    details: false,
  };
}

const unchanged = (state: DecisionState): DecisionOutcome => ({ state });

function onRow(
  state: DecisionState,
  prompt: DecisionPrompt,
  highlight: number,
): DecisionState {
  return {
    ...state,
    highlight,
    phase: highlight === prompt.options.length ? "other" : "choose",
    refusal: undefined,
  };
}

/**
 * The one set of rules both renderers follow. Number keys only move the
 * highlight, Enter is the only way to answer, and Esc steps back one level
 * until it reaches the option list, where it postpones the decision.
 */
export function reduceDecision(
  state: DecisionState,
  intent: DecisionIntent,
  prompt: DecisionPrompt,
): DecisionOutcome {
  const optionCount = prompt.options.length;
  const other = prompt.other;
  const rows = optionCount + (other === undefined ? 0 : 1);
  if (intent.type === "refused")
    return {
      state: { ...state, phase: "refused", refusal: intent.message },
    };
  if (state.phase === "sending") return unchanged(state);
  if (state.details && intent.type !== "details" && intent.type !== "escape")
    return unchanged(state);
  switch (intent.type) {
    case "move":
      return {
        state: onRow(
          state,
          prompt,
          (state.highlight + intent.delta + rows) % rows,
        ),
      };
    case "pick":
      return intent.number >= 1 && intent.number <= rows
        ? { state: onRow(state, prompt, intent.number - 1) }
        : unchanged(state);
    case "toggle": {
      const option = prompt.options[state.highlight];
      if (prompt.multiple !== true || option === undefined)
        return unchanged(state);
      const toggled = new Set(state.toggled);
      if (!toggled.delete(option.value)) toggled.add(option.value);
      return {
        state: { ...state, toggled, phase: "choose", refusal: undefined },
      };
    }
    case "type":
    case "append":
      if (other === undefined) return unchanged(state);
      return {
        state: {
          ...state,
          other: (intent.type === "append"
            ? `${state.other}${intent.text}`
            : intent.text
          ).slice(0, other.maxLength),
          highlight: optionCount,
          phase: "other",
          refusal: undefined,
        },
      };
    case "details":
      return { state: { ...state, details: !state.details } };
    case "enter": {
      const text = state.other.trim();
      const answerText = text === "" ? {} : { text };
      if (prompt.multiple === true) {
        const selected = prompt.options
          .map((option) => option.value)
          .filter((value) => state.toggled.has(value));
        if (selected.length === 0 && text === "")
          return {
            state: onRow(state, prompt, state.highlight),
          };
        return {
          state: { ...state, phase: "sending", refusal: undefined },
          effect: { type: "answer", selected, ...answerText },
        };
      }
      const option = prompt.options[state.highlight];
      if (option !== undefined)
        return {
          state: { ...state, phase: "sending", refusal: undefined },
          effect: { type: "answer", selected: [option.value] },
        };
      if (text === "") {
        if (other?.blank === undefined)
          return { state: onRow(state, prompt, optionCount) };
        return {
          state: { ...state, phase: "sending", refusal: undefined },
          effect: { type: "answer", selected: [other.blank] },
        };
      }
      return {
        state: { ...state, phase: "sending", refusal: undefined },
        effect: { type: "answer", selected: [], text },
      };
    }
    case "escape":
      if (state.details) return { state: { ...state, details: false } };
      if (state.phase === "other" || state.phase === "confirm")
        return {
          state: { ...state, highlight: 0, phase: "choose" },
          effect: { type: "back" },
        };
      if (prompt.escape !== undefined)
        return {
          state: { ...state, phase: "sending", refusal: undefined },
          effect: { type: "answer", selected: [prompt.escape] },
        };
      return { state, effect: { type: "later" } };
  }
}

/** One drawn row of a decision. */
export type DecisionRowView = Readonly<{
  /** Position among the rows; the last one is Other. */
  index: number;
  /** An offered choice, or the always-present Other row. */
  kind: "option" | "other";
  /** The number, or `[x]` / `[ ]` for a multiple decision. */
  marker: string;
  /** The choice, or the Other row's label. */
  label: string;
  /** Why or what, shown for the highlighted row when space is short. */
  description?: string | undefined;
  /** The first choice is the recommended one. */
  recommended: boolean;
  /** The row the Enter key acts on. */
  highlighted: boolean;
  /** A multiple decision's pick, or Other with text. */
  toggled: boolean;
  /** Drawn in the error tone. */
  destructive: boolean;
  /** The row's words without its marker, for a renderer that draws the marker as a control. */
  caption: string;
  /** The whole row as one plain line, marker first; renderers must show it. */
  text: string;
}>;

/** What both renderers must draw for one decision. */
export type DecisionView = Readonly<{
  /** Question or approval. */
  kind: AwaitingKind;
  /** Accessible name of the region, e.g. `Agent question 1 of 3`. */
  label: string;
  /** The prompt's title. */
  title: string;
  /** `1 of 3`, shown only when more than one decision waits. */
  counter?: string | undefined;
  /** One plain sentence under the title. */
  summary?: string | undefined;
  /** Short labelled lines under the summary, as `label  value`. */
  facts: readonly Readonly<{
    /** What the value is. */
    label: string;
    /** The value. */
    value: string;
  }>[];
  /** Long text the person wrote or the Agent asked, cut by renderers. */
  body?: string | undefined;
  /** A short name for the body. */
  bodyLabel?: string | undefined;
  /** Everything else, shown on demand. */
  details: readonly Readonly<{
    /** What the value is. */
    label: string;
    /** The value. */
    value: string;
  }>[];
  /** The long text and details replace the rows. */
  detailsOpen: boolean;
  /** The options in order, then the Other row. */
  rows: readonly DecisionRowView[];
  /** The Other row's field; absent when only the options are offered. */
  other?:
    | Readonly<{
        /** The row's name, e.g. `Other…`. */
        label: string;
        /** Hint shown in the empty field. */
        placeholder?: string | undefined;
        /** What the person has written. */
        text: string;
        /** The person is typing on this row. */
        focused: boolean;
        /** The longest answer accepted. */
        maxLength: number;
      }>
    | undefined;
  /** More than one option may be picked. */
  multiple: boolean;
  /** What the person is doing now. */
  phase: DecisionPhase;
  /** Whether Enter would send an answer now. */
  canSend: boolean;
  /** `Sending…` or the refusal, marked in words rather than colour alone. */
  status?:
    | Readonly<{
        /** Plain or alarming. */
        tone: "info" | "error";
        /** The words. */
        text: string;
      }>
    | undefined;
  /** Keys that work now, with Esc named for what it will do. */
  hints: readonly KeyHint[];
}>;

const noun = { question: "question", approval: "approval" } as const;

/** Project a decision's state into the view every renderer draws. */
export function decisionView(
  state: DecisionState,
  prompt: DecisionPrompt,
  context: Readonly<{ kind: AwaitingKind; position: number; total: number }>,
): DecisionView {
  const multiple = prompt.multiple === true;
  const optionCount = prompt.options.length;
  const otherText = state.other.trim();
  const rows: DecisionRowView[] = [
    ...prompt.options.map((option, index): DecisionRowView => {
      const toggled = state.toggled.has(option.value);
      const marker = multiple
        ? toggled
          ? "[x]"
          : "[ ]"
        : `${String(index + 1)}.`;
      const caption = `${option.label}${index === 0 ? " (recommended)" : ""}`;
      return {
        index,
        kind: "option",
        marker,
        label: option.label,
        description: option.description,
        recommended: index === 0,
        highlighted: state.highlight === index,
        toggled,
        destructive: option.destructive === true,
        caption,
        text: `${marker} ${caption}`,
      };
    }),
    ...(prompt.other === undefined
      ? []
      : [
          ((other) => {
            const toggled = multiple && otherText !== "";
            const marker = multiple
              ? toggled
                ? "[x]"
                : "[ ]"
              : `${String(optionCount + 1)}.`;
            return {
              index: optionCount,
              kind: "other" as const,
              marker,
              label: other.label,
              description: undefined,
              recommended: false,
              highlighted: state.highlight === optionCount,
              toggled,
              destructive: false,
              caption: other.label,
              text: `${marker} ${other.label}`,
            };
          })(prompt.other),
        ]),
  ];
  const typing = state.phase === "other";
  const blankLabel = prompt.options
    .find((option) => option.value === prompt.other?.blank)
    ?.label.toLowerCase();
  const escapeLabel = prompt.options
    .find((option) => option.value === prompt.escape)
    ?.label.toLowerCase();
  const sending = state.phase === "sending";
  const hasDetails =
    (prompt.details?.length ?? 0) > 0 || prompt.body !== undefined;
  const hints: KeyHint[] = sending
    ? []
    : state.details
      ? [
          { keys: "d", label: "back", priority: 0 },
          { keys: "Esc", label: "back", priority: 1 },
        ]
      : [
          { keys: "↑↓", label: "move", priority: 1 },
          ...(multiple && !typing
            ? [{ keys: "Space", label: "toggle", priority: 1 }]
            : []),
          {
            keys: "Enter",
            label:
              typing && otherText === "" && blankLabel !== undefined
                ? blankLabel
                : multiple || typing
                  ? "send"
                  : state.highlight === optionCount
                    ? "write"
                    : "choose",
            priority: 0,
          },
          ...(hasDetails
            ? [{ keys: typing ? "Alt+D" : "d", label: "details", priority: 2 }]
            : []),
          {
            keys: "Esc",
            label: typing ? "back" : (escapeLabel ?? "later"),
            priority: 2,
          },
        ];
  return {
    kind: context.kind,
    label: `Agent ${noun[context.kind]} ${String(context.position)} of ${String(context.total)}`,
    title: prompt.message,
    counter:
      context.total > 1
        ? `${String(context.position)} of ${String(context.total)}`
        : undefined,
    summary: prompt.summary,
    facts: prompt.facts ?? [],
    body: prompt.body,
    bodyLabel: prompt.bodyLabel,
    details: prompt.details ?? [],
    detailsOpen: state.details,
    rows,
    other:
      prompt.other === undefined
        ? undefined
        : {
            label: prompt.other.label,
            placeholder: prompt.other.placeholder,
            text: state.other,
            focused: typing,
            maxLength: prompt.other.maxLength,
          },
    multiple,
    phase: state.phase,
    canSend:
      !sending &&
      !state.details &&
      (multiple
        ? state.toggled.size > 0 || otherText !== ""
        : state.highlight < optionCount ||
          otherText !== "" ||
          prompt.other?.blank !== undefined),
    status: sending
      ? { tone: "info", text: "Sending…" }
      : state.phase === "refused"
        ? { tone: "error", text: state.refusal ?? "That answer was refused." }
        : undefined,
    hints,
  };
}

/**
 * The plain strings a renderer must show for a view, in reading order. The
 * lockstep tests hold every surface to this list.
 */
export function decisionViewText(view: DecisionView): readonly string[] {
  if (view.detailsOpen) return [view.title];
  return [
    view.title,
    ...(view.counter === undefined ? [] : [view.counter]),
    ...(view.summary === undefined ? [] : [view.summary]),
    ...view.facts.map((fact) => `${fact.label} ${fact.value}`),
    ...view.rows.map((row) => row.text),
    ...(view.other === undefined || view.other.text === ""
      ? []
      : [view.other.text]),
    ...(view.status === undefined ? [] : [view.status.text]),
  ];
}
