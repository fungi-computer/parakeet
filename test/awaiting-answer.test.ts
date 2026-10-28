import { parsePrompt } from "@fungi.computer/whistle/wire";
import { createWhistleInteractionHost } from "@fungi.computer/whistle/interaction";
import { describe, expect, it } from "vitest";

import {
  awaitingQueue,
  decisionView,
  decisionViewText,
  initialDecisionState,
  reduceDecision,
  type AwaitingItem,
  type DecisionIntent,
  type DecisionPrompt,
  type DecisionState,
} from "../src/core/awaiting-answer.js";

function prompt(multiple = false): DecisionPrompt {
  const parsed = parsePrompt({
    type: "decision",
    message: "Which store?",
    summary: "Notes must survive a restart.",
    options: [
      { value: "sqlite", label: "SQLite", description: "One file." },
      { value: "pg", label: "PostgreSQL" },
      { value: "none", label: "Neither" },
    ],
    other: { label: "Other…", placeholder: "Write your own", maxLength: 40 },
    multiple,
  });
  if (parsed.type !== "decision") throw new Error("expected a decision");
  return parsed;
}

function run(
  intents: readonly DecisionIntent[],
  decision = prompt(),
  from: DecisionState = initialDecisionState(),
) {
  let state = from;
  const effects: unknown[] = [];
  for (const intent of intents) {
    const outcome = reduceDecision(state, intent, decision);
    state = outcome.state;
    if (outcome.effect !== undefined) effects.push(outcome.effect);
  }
  return { state, effects };
}

const item = (key: string, arrivedAt: number): AwaitingItem => ({
  key,
  kind: "question",
  arrivedAt,
  host: createWhistleInteractionHost({ title: key }),
});

describe("the decision reducer", () => {
  it("Esc from options is Later and emits no answer", () => {
    const { state, effects } = run([
      { type: "move", delta: 1 },
      { type: "escape" },
    ]);
    expect(effects).toEqual([{ type: "later" }]);
    expect(state.phase).toBe("choose");
    expect(state.highlight).toBe(1);
  });

  it("Esc from the Other line returns to the options and keeps the text", () => {
    const { state, effects } = run([
      { type: "type", text: "MySQL" },
      { type: "escape" },
    ]);
    expect(effects).toEqual([{ type: "back" }]);
    expect(state).toMatchObject({
      phase: "choose",
      highlight: 0,
      other: "MySQL",
    });
  });

  it("number keys move highlight only", () => {
    const { state, effects } = run([
      { type: "pick", number: 2 },
      { type: "pick", number: 9 },
    ]);
    expect(effects).toEqual([]);
    expect(state).toMatchObject({ highlight: 1, phase: "choose" });
    expect(run([{ type: "pick", number: 4 }]).state.phase).toBe("other");
  });

  it("Enter answers the highlighted option once and then waits", () => {
    const { state, effects } = run([
      { type: "pick", number: 2 },
      { type: "enter" },
      { type: "enter" },
      { type: "move", delta: 1 },
    ]);
    expect(effects).toEqual([{ type: "answer", selected: ["pg"] }]);
    expect(state.phase).toBe("sending");
  });

  it("the Other line answers with its text and a blank line only waits for text", () => {
    expect(run([{ type: "pick", number: 4 }, { type: "enter" }])).toMatchObject(
      {
        effects: [],
        state: { phase: "other" },
      },
    );
    expect(
      run([{ type: "type", text: "  MySQL  " }, { type: "enter" }]).effects,
    ).toEqual([{ type: "answer", selected: [], text: "MySQL" }]);
  });

  it("multiple needs one pick or Other text", () => {
    const decision = prompt(true);
    expect(run([{ type: "enter" }], decision).effects).toEqual([]);
    expect(
      run(
        [
          { type: "toggle" },
          { type: "move", delta: 1 },
          { type: "move", delta: 1 },
          { type: "toggle" },
          { type: "enter" },
        ],
        decision,
      ).effects,
    ).toEqual([{ type: "answer", selected: ["sqlite", "none"] }]);
    expect(
      run([{ type: "type", text: "Redis" }, { type: "enter" }], decision)
        .effects,
    ).toEqual([{ type: "answer", selected: [], text: "Redis" }]);
    const toggled = run([{ type: "toggle" }, { type: "toggle" }], decision);
    expect(toggled.state.toggled.size).toBe(0);
    expect(run([{ type: "toggle" }]).state.toggled.size).toBe(0);
  });

  it("a refusal keeps the choice and clears on the next move", () => {
    const refused = run([
      { type: "enter" },
      { type: "refused", message: "That request expired." },
    ]);
    expect(refused.state).toMatchObject({
      phase: "refused",
      refusal: "That request expired.",
    });
    expect(
      decisionView(refused.state, prompt(), {
        kind: "question",
        position: 1,
        total: 1,
      }).status,
    ).toEqual({ tone: "error", text: "That request expired." });
    expect(
      reduceDecision(refused.state, { type: "move", delta: 1 }, prompt()).state,
    ).toMatchObject({ phase: "choose", refusal: undefined });
  });
});

describe("the decision view", () => {
  it("marks the first option recommended and counts a queue", () => {
    const view = decisionView(initialDecisionState(), prompt(), {
      kind: "question",
      position: 2,
      total: 3,
    });
    expect(view.label).toBe("Agent question 2 of 3");
    expect(decisionViewText(view)).toEqual([
      "Which store?",
      "2 of 3",
      "Notes must survive a restart.",
      "1. SQLite (recommended)",
      "2. PostgreSQL",
      "3. Neither",
      "4. Other…",
    ]);
    expect(view.hints.at(-1)).toMatchObject({ keys: "Esc", label: "later" });
  });

  it("draws toggles for a multiple decision and names Esc as back on the Other line", () => {
    const decision = prompt(true);
    const { state } = run(
      [{ type: "toggle" }, { type: "type", text: "Redis" }],
      decision,
    );
    const view = decisionView(state, decision, {
      kind: "question",
      position: 1,
      total: 1,
    });
    expect(view.counter).toBeUndefined();
    expect(view.rows.map((row) => row.text)).toEqual([
      "[x] SQLite (recommended)",
      "[ ] PostgreSQL",
      "[ ] Neither",
      "[x] Other…",
    ]);
    expect(view.hints.at(-1)).toMatchObject({ keys: "Esc", label: "back" });
  });
});

describe("the awaiting queue", () => {
  it("keeps arrival order and counts postponed items", () => {
    const items = [item("b", 2), item("a", 1), item("c", 3)];
    expect(awaitingQueue(items, new Set()).current?.key).toBe("a");
    const queue = awaitingQueue(items, new Set(["a"]));
    expect(queue).toMatchObject({ position: 2, total: 3 });
    expect(queue.current?.key).toBe("b");
    expect(
      awaitingQueue(items, new Set(["a", "b", "c"])).current,
    ).toBeUndefined();
    expect(awaitingQueue([], new Set())).toMatchObject({
      position: 0,
      total: 0,
    });
  });
});

describe("approval decisions", () => {
  const approval = (): DecisionPrompt => {
    const parsed = parsePrompt({
      type: "decision",
      message: "Allow `git add`?",
      options: [
        { value: "approve", label: "Approve once" },
        { value: "deny", label: "Deny" },
      ],
      other: {
        label: "Deny and say why…",
        maxLength: 40,
        blank: "deny",
      },
    });
    if (parsed.type !== "decision") throw new Error("expected a decision");
    return parsed;
  };
  const confirm = (): DecisionPrompt => {
    const parsed = parsePrompt({
      type: "decision",
      message: "Always allow?",
      options: [
        { value: "back", label: "Back" },
        { value: "go", label: "Go" },
      ],
      escape: "back",
    });
    if (parsed.type !== "decision") throw new Error("expected a decision");
    return parsed;
  };

  it("Enter on a blank Other line answers its blank option; typed text still wins", () => {
    expect(
      run([{ type: "pick", number: 3 }, { type: "enter" }], approval()).effects,
    ).toEqual([{ type: "answer", selected: ["deny"] }]);
    expect(
      run(
        [{ type: "type", text: "Use the sandbox" }, { type: "enter" }],
        approval(),
      ).effects,
    ).toEqual([{ type: "answer", selected: [], text: "Use the sandbox" }]);
  });

  it("a blank Other line names what Enter will do", () => {
    const { state } = run([{ type: "pick", number: 3 }], approval());
    const view = decisionView(state, approval(), {
      kind: "approval",
      position: 1,
      total: 1,
    });
    expect(view.hints.find((hint) => hint.keys === "Enter")?.label).toBe(
      "deny",
    );
    expect(view.canSend).toBe(true);
  });

  it("Esc answers a confirmation's own escape option instead of postponing", () => {
    const { effects, state } = run([{ type: "escape" }], confirm());
    expect(effects).toEqual([{ type: "answer", selected: ["back"] }]);
    expect(state.phase).toBe("sending");
    const view = decisionView(initialDecisionState(), confirm(), {
      kind: "approval",
      position: 1,
      total: 1,
    });
    expect(view.rows.map((row) => row.kind)).toEqual(["option", "option"]);
    expect(view.other).toBeUndefined();
    expect(view.hints.at(-1)).toMatchObject({ keys: "Esc", label: "back" });
  });

  it("with no Other row there is nothing to type into or land on", () => {
    expect(run([{ type: "type", text: "x" }], confirm()).state.other).toBe("");
    expect(
      run(
        [
          { type: "move", delta: 1 },
          { type: "move", delta: 1 },
        ],
        confirm(),
      ).state.highlight,
    ).toBe(0);
  });
});
