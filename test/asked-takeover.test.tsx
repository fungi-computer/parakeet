// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { createWhistleInteractionHost } from "@fungi.computer/whistle/interaction";
import type { AwaitingItem } from "../src/core/awaiting-answer.js";
import { useAskedTakeover } from "../src/use-asked-takeover.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

function Probe({ item }: Readonly<{ item: AwaitingItem | undefined }>) {
  const taken = useAskedTakeover(item);
  return <p data-taken>{taken?.key ?? "none"}</p>;
}

function waiting(key: string) {
  const host = createWhistleInteractionHost({ title: "Approval" });
  const session = host.begin();
  const item: AwaitingItem = { key, kind: "approval", arrivedAt: 0, host };
  return { host, session, item };
}

const decision = {
  type: "decision",
  message: "Allow Tourtois to add a widget?",
  options: [
    { value: "approve", label: "Approve once" },
    { value: "deny", label: "Deny" },
  ],
} as const;

/**
 * A waiting item whose conversation has not asked anything has nothing to
 * draw: taking the composer over for it leaves a blank bar and no way to type.
 */
it("takes the composer over only once the waiting item has asked its question", async () => {
  const { host, session, item } = waiting("approval:one");
  const container = document.createElement("div");
  const root = createRoot(container);
  const text = () => container.querySelector("[data-taken]")?.textContent;
  await act(async () => {
    root.render(<Probe item={item} />);
    await Promise.resolve();
  });
  expect(text()).toBe("none");
  void session.interaction.prompt(decision);
  await act(async () => {
    await Promise.resolve();
  });
  expect(host.snapshot().prompt).toBeDefined();
  expect(text()).toBe("approval:one");
  // Answered: the card keeps its place while the answer is sent.
  const sequence = host.snapshot().prompt?.sequence ?? -1;
  await act(async () => {
    host.answer(sequence, { selected: ["approve"] });
    await Promise.resolve();
  });
  expect(host.snapshot().prompt).toBeUndefined();
  expect(text()).toBe("approval:one");
  await act(async () => {
    root.unmount();
    await Promise.resolve();
  });
});

it("takes nothing over when nothing waits", async () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => {
    root.render(<Probe item={undefined} />);
    await Promise.resolve();
  });
  expect(container.querySelector("[data-taken]")?.textContent).toBe("none");
  await act(async () => {
    root.unmount();
    await Promise.resolve();
  });
});
