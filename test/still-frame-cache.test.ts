import { afterEach, expect, it } from "vitest";

import {
  captureStillFrame,
  clearStillFrameCache,
  getStillFrame,
  setStillFrame,
  stillFrameKey,
} from "../src/components/still-frame-cache.js";

it("keeps the live Sprite when canvas export is denied", () => {
  const host = document.createElement("div");
  const canvas = document.createElement("canvas");
  host.append(canvas);
  canvas.toDataURL = () => {
    throw new DOMException("The canvas is tainted", "SecurityError");
  };
  expect(captureStillFrame(host)).toBeUndefined();
});

it.each([
  new Error("Canvas renderer failed"),
  new DOMException("Canvas renderer unavailable", "InvalidStateError"),
])("propagates unexpected canvas export failure %s with its cause", (cause) => {
  const host = document.createElement("div");
  const canvas = document.createElement("canvas");
  host.append(canvas);
  canvas.toDataURL = () => {
    throw cause;
  };
  expect(() => captureStillFrame(host)).toThrow(
    expect.objectContaining({
      message: "Could not capture an avatar still frame",
      cause,
    }),
  );
});

afterEach(() => {
  clearStillFrameCache();
});

const presentation = {
  src: { local: "mushroom" as const },
  appearance: { cap: "#f98284", capSpot: "#ffe6c6" },
  expression: "normal",
  renderStyle: "plain" as const,
};

it("keys are stable for the same presentation, size and pixel ratio", () => {
  expect(stillFrameKey(presentation, 24, 1)).toBe(
    stillFrameKey(presentation, 24, 1),
  );
});

it("keys differ by size and pixel ratio", () => {
  expect(stillFrameKey(presentation, 24, 1)).not.toBe(
    stillFrameKey(presentation, 48, 1),
  );
  expect(stillFrameKey(presentation, 24, 1)).not.toBe(
    stillFrameKey(presentation, 24, 2),
  );
});

it("returns undefined for an uncached key, then the value once set", () => {
  const key = stillFrameKey(presentation, 24, 1);
  expect(getStillFrame(key)).toBeUndefined();
  setStillFrame(key, "data:image/png;base64,one");
  expect(getStillFrame(key)).toBe("data:image/png;base64,one");
});

it("evicts the oldest entry once past 128", () => {
  for (let index = 0; index < 129; index += 1) {
    setStillFrame(
      `key-${String(index)}`,
      `data:image/png;base64,${String(index)}`,
    );
  }
  expect(getStillFrame("key-0")).toBeUndefined();
  expect(getStillFrame("key-128")).toBe("data:image/png;base64,128");
});

it("reading a frame refreshes its recency", () => {
  setStillFrame("key-a", "data:image/png;base64,a");
  for (let index = 0; index < 127; index += 1) {
    setStillFrame(`filler-${String(index)}`, "data:image/png;base64,x");
  }
  // key-a is now the oldest of 128 entries; reading it should save it from
  // the next eviction.
  expect(getStillFrame("key-a")).toBe("data:image/png;base64,a");
  setStillFrame("overflow", "data:image/png;base64,y");
  expect(getStillFrame("key-a")).toBe("data:image/png;base64,a");
  expect(getStillFrame("filler-0")).toBeUndefined();
});
