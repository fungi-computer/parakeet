// @vitest-environment jsdom
import type { Avatar } from "@fungi.computer/sprite/avatar";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";

import { agentAppearance } from "@fungi.computer/sprite/avatar";
import { avatarPresentation } from "../src/components/avatar-presentation.js";
import { AgentHead } from "../src/components/AgentHead.js";
import {
  clearStillFrameCache,
  setStillFrame,
  stillFrameKey,
} from "../src/components/still-frame-cache.js";

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
  clearStillFrameCache();
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

it("matches the pre-avatar implementation's colours for known seeds (golden values)", () => {
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
  const container = mount(<AgentHead name="Gardener" seed="gardener" />);
  const head = container.querySelector("[data-agent-head]");
  expect(head?.getAttribute("aria-hidden")).toBe("true");
  expect(head?.getAttribute("data-agent-head")).toBe("loading");
  expect(head?.textContent).toBe("G");
});

it("sizes the head in pixels", () => {
  const container = mount(
    <AgentHead name="Maker" seed="maker" size={64} activity="thinking" />,
  );
  const head = container.querySelector<HTMLElement>("[data-agent-head]");
  expect(head?.style.width).toBe("64px");
  expect(head?.style.height).toBe("64px");
});

it("falls back to the seeded mushroom when no avatar is given, byte for byte", () => {
  const seed = "agent-fallback";
  const presentation = avatarPresentation(undefined, seed);
  expect(presentation.src).toEqual({ local: "mushroom" });
  expect(presentation.appearance).toEqual(agentAppearance(seed));
  expect(presentation.expression).toBe("normal");
  expect(presentation.renderStyle).toBe("plain");
});

it("an idle head with a cached still frame shows it instead of mounting a live canvas", () => {
  const seed = "agent-cached";
  const presentation = avatarPresentation(undefined, seed);
  const key = stillFrameKey(presentation, 24, 1);
  setStillFrame(key, "data:image/png;base64,cached");

  const idle = mount(<AgentHead name="Cached" seed={seed} activity="idle" />);
  const img = idle.querySelector("img");
  expect(img?.getAttribute("src")).toBe("data:image/png;base64,cached");
  expect(
    idle.querySelector("[data-agent-head]")?.getAttribute("data-agent-head"),
  ).toBe("ready");
});

it.each(["thinking", "speaking"] as const)(
  "keeps the cached head visible while its %s player loads",
  (activity) => {
    const seed = "agent-transition";
    const key = stillFrameKey(avatarPresentation(undefined, seed), 24, 1);
    const frame = "data:image/png;base64,cached";
    setStillFrame(key, frame);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.add(root);
    act(() => {
      root.render(<AgentHead name="Transition" seed={seed} />);
    });
    expect(container.querySelector("img")?.getAttribute("src")).toBe(frame);
    act(() => {
      root.render(
        <AgentHead name="Transition" seed={seed} activity={activity} />,
      );
    });
    expect(container.querySelector("img")?.getAttribute("src")).toBe(frame);
  },
);

it("a cached frame never substitutes for a non-plain render style: the style is a live filter, not canvas pixels", () => {
  const avatar: Avatar = {
    v: 1,
    character: "mushroom",
    appearance: { cap: "#f98284", capSpot: "#ffe6c6" },
    expression: "normal",
    renderStyle: "manga",
  };
  const presentation = avatarPresentation(avatar, "agent-styled");
  const key = stillFrameKey(presentation, 24, 1);
  // Simulate a frame already cached under this (adversarial) key: capture is
  // gated to "plain" in normal operation, but the idle/live switch must not
  // trust a cached frame for a styled descriptor even if one exists.
  setStillFrame(key, "data:image/png;base64,styled-but-stale");

  const container = mount(
    <AgentHead
      avatar={avatar}
      name="Styled"
      seed="agent-styled"
      activity="idle"
    />,
  );
  expect(container.querySelector("img")).toBeNull();
});

it("a stored avatar changes which character and colours are requested", () => {
  const avatar: Avatar = {
    v: 1,
    character: "cat",
    appearance: { body: "#ffe6c6", stripes: "#dea38b" },
    expression: "happy",
    renderStyle: "plain",
  };
  const presentation = avatarPresentation(avatar, "agent-whatever");
  expect(presentation.src).toEqual({ local: "cat" });
  expect(presentation.appearance).toEqual(avatar.appearance);
  expect(presentation.expression).toBe("happy");
});
