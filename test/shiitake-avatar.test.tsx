// @vitest-environment jsdom
import type {
  AvatarPlayer,
  AvatarPresentation,
  PlayerState,
} from "@fungi.computer/sprite";
import type { Avatar } from "@fungi.computer/sprite/avatar";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";

import { ShiitakeAvatar } from "../src/components/ShiitakeAvatar.js";

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

/**
 * A faithful `SpriteService` fake: no canvas, no asset loading, just a
 * record of every presentation it was asked to set. Real dependency
 * injection through the Sprite service seam (not a mocked module), so
 * `ShiitakeAvatar`'s own prop-construction runs for real through the real
 * `<Sprite>` component.
 */
function recordingSpriteService() {
  const presentations: AvatarPresentation[] = [];
  const player: AvatarPlayer = {
    state: { status: "empty" } satisfies PlayerState,
    subscribe: () => () => undefined,
    set: (next) => {
      presentations.push(next);
    },
    pause: () => undefined,
    dispose: () => Promise.resolve(),
  };
  return { service: { mount: () => player }, presentations };
}

it("draws the product mascot when no avatar is given: the mushroom, no appearance override", () => {
  const { service, presentations } = recordingSpriteService();
  mount(
    <ShiitakeAvatar
      service={service}
      state={{ activity: "idle", expression: "normal" }}
    />,
  );
  const last = presentations.at(-1);
  expect(last?.src).toEqual({ local: "mushroom" });
  expect(last?.appearance).toBeUndefined();
  expect(last?.renderStyle).toBeUndefined();
});

it("draws a stored avatar's character, appearance and render style", () => {
  const { service, presentations } = recordingSpriteService();
  const avatar: Avatar = {
    v: 1,
    character: "burger",
    appearance: { topBun: "#f4a261" },
    expression: "happy",
    renderStyle: "manga",
  };
  mount(
    <ShiitakeAvatar
      avatar={avatar}
      service={service}
      state={{ activity: "idle", expression: "normal" }}
    />,
  );
  const last = presentations.at(-1);
  expect(last?.src).toEqual({ local: "burger" });
  expect(last?.appearance).toEqual(avatar.appearance);
  expect(last?.renderStyle).toBe("manga");
});

it("lets the live state override the avatar's own expression and activity", () => {
  const { service, presentations } = recordingSpriteService();
  const avatar: Avatar = {
    v: 1,
    character: "mushroom",
    appearance: { cap: "#f98284" },
    expression: "normal",
    renderStyle: "plain",
  };
  mount(
    <ShiitakeAvatar
      avatar={avatar}
      service={service}
      state={{ activity: "thinking", expression: "confused" }}
    />,
  );
  const last = presentations.at(-1);
  expect(last?.activity).toBe("thinking");
  expect(last?.expression).toBe("confused");
});
