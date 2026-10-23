// @vitest-environment jsdom
import { act, memo } from "react";
import { AnimationTimeProvider, Sprite } from "@fungi.computer/sprite/react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { AgentHead } from "../src/components/AgentHead.js";
import { shiitakeSprite } from "../src/components/sprite-service.js";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});

it("forwards backward and forward seeks through the real Sprite player and restores live motion", () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  const mounted = vi.spyOn(shiitakeSprite, "mount");
  const avatar = {
    v: 1,
    character: "mushroom",
    appearance: {},
    expression: "happy",
    renderStyle: "plain",
  } as const;
  try {
    act(() => {
      root.render(
        <AgentHead
          name="Shiitake"
          avatar={avatar}
          activity="speaking"
          timeMs={500}
        />,
      );
    });
    const result = mounted.mock.results[0];
    if (result?.type !== "return") throw new Error("Sprite did not mount");
    const set = vi.spyOn(result.value, "set");
    const pause = vi.spyOn(result.value, "pause");
    for (const timeMs of [100, 900]) {
      act(() => {
        root.render(
          <AgentHead
            name="Shiitake"
            avatar={avatar}
            activity="speaking"
            timeMs={timeMs}
          />,
        );
      });
      expect(set).toHaveBeenLastCalledWith(expect.objectContaining({ timeMs }));
    }
    act(() => {
      root.render(
        <AgentHead name="Shiitake" avatar={avatar} activity="speaking" />,
      );
    });
    expect(set.mock.lastCall?.[0].timeMs).toBeUndefined();
    expect(pause).toHaveBeenLastCalledWith(false);
  } finally {
    act(() => {
      root.unmount();
    });
    vi.restoreAllMocks();
  }
});

it("clocks nested memoized heads and direct Sprites without changing App props", () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  const mounted = vi.spyOn(shiitakeSprite, "mount");
  const avatar = {
    v: 1,
    character: "mushroom",
    appearance: {},
    expression: "happy",
    renderStyle: "plain",
  } as const;
  const App = memo(function App() {
    return (
      <section>
        <AgentHead name="Shiitake" avatar={avatar} activity="speaking" />
        <Sprite
          service={shiitakeSprite}
          src={{ local: "mushroom" }}
          activity="speaking"
        />
        <AgentHead
          name="Explicit"
          avatar={avatar}
          activity="speaking"
          timeMs={0}
        />
      </section>
    );
  });
  try {
    act(() => {
      root.render(
        <AnimationTimeProvider timeMs={500}>
          <App />
        </AnimationTimeProvider>,
      );
    });
    const players = mounted.mock.results.map((result) => {
      if (result.type !== "return") throw new Error("Sprite did not mount");
      return {
        set: vi.spyOn(result.value, "set"),
        pause: vi.spyOn(result.value, "pause"),
      };
    });
    expect(players).toHaveLength(3);
    for (const timeMs of [100, 900, undefined]) {
      act(() => {
        root.render(
          <AnimationTimeProvider {...(timeMs === undefined ? {} : { timeMs })}>
            <App />
          </AnimationTimeProvider>,
        );
      });
      for (const player of players.slice(0, 2)) {
        expect(player.set.mock.lastCall?.[0].timeMs).toBe(timeMs);
        if (timeMs === undefined)
          expect(player.pause).toHaveBeenLastCalledWith(false);
      }
      expect(players[2]?.set).not.toHaveBeenCalled();
    }
  } finally {
    act(() => {
      root.unmount();
    });
    vi.restoreAllMocks();
  }
});
