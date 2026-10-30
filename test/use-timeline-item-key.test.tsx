// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";

import { useTimelineItemKey } from "../src/core/use-timeline-item-key.js";
import type { TimelineItem, UserMessageItem } from "../src/store/types.js";
import { toolGroup } from "../src/core/tool-groups.js";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
  writable: true,
});

type Key = (index: number) => string | number;

const roots = new Set<Root>();

afterEach(async () => {
  await act(async () => {
    for (const root of roots) root.unmount();
    await Promise.resolve();
  });
  roots.clear();
});

const prompt = (id: string, text = id): UserMessageItem => ({
  id,
  kind: "user_message",
  status: "confirmed",
  text,
});
const submitted = (id: string, requestId: string): UserMessageItem => ({
  ...prompt(id),
  requestId,
});

/** Mounts the hook and reports every key callback it returns, per render. */
function mountKeyHook() {
  const container = document.createElement("div");
  const root = createRoot(container);
  roots.add(root);
  const callbacks = new Set<Key>();
  let latest: Key | undefined;
  function Probe({
    settled,
    tail,
  }: {
    settled: readonly TimelineItem[];
    tail: readonly TimelineItem[];
  }) {
    const getItemKey = useTimelineItemKey(settled, tail);
    callbacks.add(getItemKey);
    latest = getItemKey;
    return null;
  }
  return {
    callbacks,
    key: (index: number) => {
      if (latest === undefined) throw new Error("Hook has not rendered");
      return latest(index);
    },
    render: async (
      settled: readonly TimelineItem[],
      tail: readonly TimelineItem[],
    ) => {
      await act(async () => {
        root.render(<Probe settled={settled} tail={tail} />);
        await Promise.resolve();
      });
    },
  };
}

const history = [prompt("h0"), prompt("h1"), prompt("h2")];

it("keeps one key callback across text-only revisions of the tail", async () => {
  const hook = mountKeyHook();
  await hook.render(history, [prompt("live", "a")]);
  for (const text of ["ab", "abc", "abcd", "abcde"])
    await hook.render(history, [prompt("live", text)]);

  expect(hook.callbacks.size).toBe(1);
  expect([0, 1, 2, 3].map(hook.key)).toEqual(["h0", "h1", "h2", "live"]);
});

it("keeps measured row identity across live output overlays on durable calls", async () => {
  const hook = mountKeyHook();
  for (const revision of [1, 2, 3]) {
    await hook.render(
      [
        ...history,
        toolGroup([
          {
            id: "build",
            kind: "tool",
            name: "execute",
            args: { code: "return 1;" },
            status: "running",
            live: {
              lines: [`step ${String(revision)}`],
              droppedBytes: 0,
              revision,
            },
          },
        ]),
      ],
      [],
    );
  }
  expect(hook.callbacks.size).toBe(1);
  expect([0, 3].map(hook.key)).toEqual(["h0", "tools:build"]);
});

it("issues a new key callback when the tail gains a row", async () => {
  const hook = mountKeyHook();
  await hook.render(history, [prompt("live")]);
  await hook.render(history, [prompt("live"), prompt("queued")]);

  expect(hook.callbacks.size).toBe(2);
  expect(hook.key(4)).toBe("queued");
});

it("issues a new key callback when a submitted prompt's request identity arrives", async () => {
  const hook = mountKeyHook();
  await hook.render(history, [prompt("command-1")]);
  expect(hook.key(3)).toBe("command-1");
  await hook.render(history, [submitted("command-1", "request-1")]);

  expect(hook.callbacks.size).toBe(2);
  expect(hook.key(3)).toBe("request-1");
});

it("issues a new key callback when the settled history changes", async () => {
  const hook = mountKeyHook();
  await hook.render(history, [prompt("live")]);
  await hook.render([prompt("older"), ...history], [prompt("live")]);

  expect(hook.callbacks.size).toBe(2);
  expect([0, 1, 4].map(hook.key)).toEqual(["older", "h0", "live"]);
});

it("keys a settled index from the settled history alone", async () => {
  const hook = mountKeyHook();
  await hook.render(history, [prompt("h1", "a tail row reusing a history id")]);

  expect(hook.key(1)).toBe("h1");
  expect(hook.key(3)).toBe("h1");
  expect(hook.key(9)).toBe(9);
});
