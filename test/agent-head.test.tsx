// @vitest-environment jsdom
import type { Avatar } from "@fungi.computer/sprite/avatar";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";

import { agentAppearance, seededAvatar } from "@fungi.computer/sprite/avatar";
import { avatarPresentation } from "../src/components/avatar-presentation.js";
import { AgentHead } from "../src/components/AgentHead.js";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
  writable: true,
});

const roots = new Set<Root>();
afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount();
    });
  }
  roots.clear();
  document.body.replaceChildren();
});

function mount(node: React.ReactNode): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.add(root);
  act(() => {
    root.render(node);
  });
  return container;
}

it("gives an identity the same cap colour every time, as a valid control colour", () => {
  const first = agentAppearance("agent-gardener");
  expect(agentAppearance("agent-gardener")).toEqual(first);
  expect(first.cap).toMatch(/^#[0-9a-f]{6}$/u);
  expect(first.capSpot).toMatch(/^#[0-9a-f]{6}$/u);
  const caps = new Set(
    ["gardener", "librarian", "maker", "scribe", "sprout", "moss"].map(
      (seed) => agentAppearance(seed).cap,
    ),
  );
  // Six different agents should not all wear one cap.
  expect(caps.size).toBeGreaterThan(3);
});

it("matches the seeded colours for known seeds (golden values)", () => {
  // `agentAppearance` now lives at @fungi.computer/sprite/avatar; comparing
  // it against itself cannot catch a regression in the moved algorithm, so
  // these are hardcoded from the original agent-appearance.ts output.
  expect(agentAppearance("agent-gardener")).toEqual({
    cap: "#8796e8",
    capSpot: "#dce1f9",
  });
  expect(agentAppearance("agent-librarian")).toEqual({
    cap: "#e887d0",
    capSpot: "#f9dcf2",
  });
  expect(agentAppearance("agent-moss")).toEqual({
    cap: "#e8c687",
    capSpot: "#f9efdc",
  });
});

it("shows the letter until the sprite is ready, and is decorative", () => {
  const container = mount(
    <AgentHead name="Gardener" avatar={seededAvatar("gardener")} />,
  );
  const head = container.querySelector("[data-agent-head]");
  expect(head?.getAttribute("aria-hidden")).toBe("true");
  expect(head?.getAttribute("data-agent-head")).toBe("loading");
  expect(head?.textContent).toBe("G");
});

it("sizes the head in pixels", () => {
  const container = mount(
    <AgentHead
      name="Maker"
      avatar={seededAvatar("maker")}
      size={64}
      activity="thinking"
    />,
  );
  const head = container.querySelector<HTMLElement>("[data-agent-head]");
  expect(head?.style.width).toBe("64px");
  expect(head?.style.height).toBe("64px");
});

it("presents a seeded avatar as the seeded mushroom, byte for byte", () => {
  const seed = "agent-fallback";
  const presentation = avatarPresentation(seededAvatar(seed));
  expect(presentation.src).toEqual({ local: "mushroom" });
  expect(presentation.appearance).toEqual(agentAppearance(seed));
  expect(presentation.expression).toBe("normal");
  expect(presentation.renderStyle).toBe("plain");
});

it("an idle head keeps a live canvas mounted and never an image snapshot", () => {
  const container = mount(
    <AgentHead name="Idle" avatar={seededAvatar("agent-idle")} />,
  );
  expect(container.querySelector("img")).toBeNull();
  expect(container.querySelector("[data-agent-head]")).not.toBeNull();
});

it("an Agent's avatar picks which character and colours are requested", () => {
  const avatar: Avatar = {
    v: 1,
    character: "cat",
    appearance: { body: "#ffe6c6", stripes: "#dea38b" },
    expression: "happy",
    renderStyle: "plain",
  };
  const presentation = avatarPresentation(avatar);
  expect(presentation.src).toEqual({ local: "cat" });
  expect(presentation.appearance).toEqual(avatar.appearance);
  expect(presentation.expression).toBe("happy");
});
