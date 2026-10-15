import { expect, it } from "vitest";

import * as headless from "../src/headless.js";
import * as parakeet from "../src/index.js";

it("exports the narrow conversation hooks through both public surfaces", () => {
  for (const name of [
    "ParakeetProvider",
    "useTimeline",
    "useComposer",
    "useStatus",
  ] as const) {
    expect(headless).toHaveProperty(name, expect.any(Function));
    expect(parakeet).toHaveProperty(name, headless[name]);
  }
  expect(parakeet).toHaveProperty("ParakeetView", expect.any(Function));
});
