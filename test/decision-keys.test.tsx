// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { createWhistleInteractionHost } from "@fungi.computer/whistle/interaction";
import type { WhistleDecisionAnswer } from "@fungi.computer/whistle";
import type { AwaitingItem } from "../src/core/awaiting-answer.js";
import { DecisionComposer } from "../src/components/DecisionComposer.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const ask = {
  type: "decision",
  message: "What should I help you with?",
  options: [
    { value: "project", label: "Help with a project" },
    { value: "everyday", label: "Everyday help" },
    { value: "unsure", label: "Not sure yet" },
  ],
  other: { label: "Other…", maxLength: 100 },
} as const;

async function mount() {
  const host = createWhistleInteractionHost({ title: "Question" });
  const session = host.begin();
  const answers: WhistleDecisionAnswer[] = [];
  void session.interaction.prompt(ask).then((given) => {
    answers.push(given);
  });
  const item: AwaitingItem = {
    key: "ask:keys",
    kind: "question",
    arrivedAt: 0,
    host,
  };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <DecisionComposer
        item={item}
        position={1}
        total={1}
        onLater={() => undefined}
        takeFocus
      />,
    );
    await Promise.resolve();
  });
  const list = () => {
    const found = container.querySelector<HTMLElement>('[role="listbox"]');
    if (found === null) throw new Error("Missing list");
    return found;
  };
  const press = async (key: string, shift = false) =>
    act(async () => {
      (document.activeElement ?? list()).dispatchEvent(
        new KeyboardEvent("keydown", {
          key,
          shiftKey: shift,
          bubbles: true,
          cancelable: true,
        }),
      );
      await Promise.resolve();
    });
  const highlighted = () =>
    [...container.querySelectorAll("[data-highlight]")].map((node) =>
      node.textContent.trim(),
    );
  return {
    answers,
    container,
    list,
    press,
    highlighted,
    close: async () => {
      await act(async () => {
        root.unmount();
        await Promise.resolve();
      });
      container.remove();
    },
  };
}

it("moves between options with the arrows and Vim's j and k", async () => {
  const card = await mount();
  try {
    expect(card.highlighted()).toEqual([]);
    await card.press("j");
    expect(card.highlighted()[0]).toContain("Help with a project");
    await card.press("ArrowDown");
    expect(card.highlighted()[0]).toContain("Everyday help");
    await card.press("j");
    expect(card.highlighted()[0]).toContain("Not sure yet");
    await card.press("k");
    expect(card.highlighted()[0]).toContain("Everyday help");
    await card.press("ArrowUp");
    expect(card.highlighted()[0]).toContain("Help with a project");
    // Moving never answers.
    expect(card.answers).toEqual([]);
  } finally {
    await card.close();
  }
});

it("picks the highlighted option with Enter or Space, and nothing before a move", async () => {
  const first = await mount();
  try {
    await first.press("Enter");
    await first.press(" ");
    expect(first.answers).toEqual([]);
    await first.press("j");
    await first.press("j");
    await first.press("Enter");
    expect(first.answers).toEqual([{ selected: ["everyday"] }]);
  } finally {
    await first.close();
  }
  const second = await mount();
  try {
    await second.press("ArrowDown");
    await second.press(" ");
    expect(second.answers).toEqual([{ selected: ["project"] }]);
  } finally {
    await second.close();
  }
});

it("Tab moves to the type-it field, Shift+Tab returns, and focus stays on a control", async () => {
  const card = await mount();
  try {
    expect(document.activeElement).toBe(card.list());
    await card.press("j");
    await card.press("Tab");
    const field = card.container.querySelector("input");
    expect(field).not.toBeNull();
    expect(document.activeElement).toBe(field);
    await card.press("Tab", true);
    expect(document.activeElement).toBe(card.list());
    // Shift+Tab gives back the highlight Tab left, not a neighbouring option.
    expect(card.highlighted()[0]).toContain("Help with a project");
    expect(card.answers).toEqual([]);
  } finally {
    await card.close();
  }
});

it("leaving the field never highlights an option the person did not choose", async () => {
  const card = await mount();
  try {
    // Tab from nothing highlighted, then Shift+Tab: still nothing to send.
    await card.press("Tab");
    expect(document.activeElement).toBe(card.container.querySelector("input"));
    await card.press("Tab", true);
    expect(card.highlighted()).toEqual([]);
    await card.press("Enter");
    await card.press(" ");
    expect(card.answers).toEqual([]);
  } finally {
    await card.close();
  }
});

it("starts the type-it answer with any letter but j and k", async () => {
  const card = await mount();
  try {
    await card.press("x");
    const field = card.container.querySelector("input");
    expect(field?.value).toBe("x");
    expect(card.answers).toEqual([]);
  } finally {
    await card.close();
  }
});
