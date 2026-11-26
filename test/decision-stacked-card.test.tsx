// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { createWhistleInteractionHost } from "@fungi.computer/whistle/interaction";
import {
  decisionView,
  unselectedDecisionState,
  type AwaitingItem,
} from "../src/core/awaiting-answer.js";
import {
  DecisionComposer,
  DecisionPanel,
} from "../src/components/DecisionComposer.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const ask = {
  type: "decision",
  message: "What should I help you with?",
  options: [
    { value: "project", label: "Help with a project" },
    { value: "everyday", label: "Everyday help" },
  ],
} as const;

function card(key: string) {
  const host = createWhistleInteractionHost({ title: "Question" });
  const session = host.begin();
  void session.interaction.prompt(ask);
  const item: AwaitingItem = { key, kind: "question", arrivedAt: 0, host };
  return { host, item };
}

/**
 * A repeated ask stacks a second card for the same question. When the card the
 * person was answering leaves, the next one takes its place; a click on Send
 * meant for the first card must not answer the second with its recommended
 * first option.
 */
it("a card that replaces the one being answered starts with nothing picked", async () => {
  const first = card("ask:first");
  const second = card("ask:second");
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = async (item: AwaitingItem) =>
    act(async () => {
      root.render(
        <DecisionComposer
          item={item}
          key={item.key}
          position={1}
          total={2}
          onLater={() => undefined}
          takeFocus={false}
        />,
      );
      await Promise.resolve();
    });
  const send = () =>
    [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Send",
    );
  await render(first.item);
  const option = (label: string) =>
    [...container.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (row) => row.textContent.includes(label),
    );
  await act(async () => {
    option("Everyday help")?.click();
    await Promise.resolve();
  });
  expect(send()?.disabled).toBe(false);
  // The first card is withdrawn and the second takes its place.
  await render(second.item);
  expect(send()?.disabled).toBe(true);
  await act(async () => {
    send()?.click();
    await Promise.resolve();
  });
  expect(second.host.snapshot().prompt).toBeDefined();
  expect(second.host.snapshot().status).not.toBe("sending");
  await act(async () => {
    root.unmount();
    await Promise.resolve();
  });
  container.remove();
});

it("shows a refused answer as a toast, not as text in the card", async () => {
  const view = decisionView(
    {
      ...unselectedDecisionState(),
      phase: "refused",
      refusal: "That answer was not accepted. Choose again.",
    },
    ask,
    { kind: "question", position: 1, total: 1 },
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const toasts: string[] = [];
  await act(async () => {
    root.render(
      <DecisionPanel
        view={view}
        dispatch={() => undefined}
        onLater={() => undefined}
        takeFocus={false}
        onRefusal={(message) => {
          toasts.push(message);
          return true;
        }}
      />,
    );
    await Promise.resolve();
  });
  expect(toasts).toEqual(["That answer was not accepted. Choose again."]);
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.textContent).not.toContain("not accepted");
  await act(async () => {
    root.unmount();
    await Promise.resolve();
  });
  container.remove();
});

it("keeps a refused answer inline when no toast surface takes it", async () => {
  const view = decisionView(
    {
      ...unselectedDecisionState(),
      phase: "refused",
      refusal: "That answer was not accepted. Choose again.",
    },
    ask,
    { kind: "question", position: 1, total: 1 },
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <DecisionPanel
        view={view}
        dispatch={() => undefined}
        onLater={() => undefined}
        takeFocus={false}
        onRefusal={() => false}
      />,
    );
    await Promise.resolve();
  });
  expect(container.textContent).toContain("not accepted");
  await act(async () => {
    root.unmount();
    await Promise.resolve();
  });
  container.remove();
});
