import { expect, it } from "vitest";
import { liveOutputLines } from "../src/core/tool-view.js";

it.each([
  ["zero-width space", "\u200b"],
  ["word joiner", "\u2060"],
  ["retained BOM", "\ufeff"],
])(
  "removes %s from live output just as final display text does",
  (_, character) => {
    expect(
      liveOutputLines(
        `\u001b[31msafe${character}\u0000\u0007\u0085\u202e\u2066output\u2069\u001b[0m`,
      ),
    ).toEqual(["safeoutput"]);
  },
);

it("renders producer text without ANSI, controls or bidi, and retains the last bare-CR overwrite", () => {
  expect(
    liveOutputLines(
      "\u001b[31mfirst\u001b[0m\r\nold\rnew\rfinal\nsafe\u0000\u0007\u202e\u2066text\u2069\n",
    ),
  ).toEqual(["first", "final", "safetext"]);
});

it("preserves readable UTF-8 and tabs, but represents replacement-dominated output as binary", () => {
  expect(liveOutputLines("café\t🍄\n�one bad byte\n")).toEqual([
    "café\t🍄",
    "�one bad byte",
  ]);
  expect(liveOutputLines("���x")).toEqual(["[binary output, 10 bytes]"]);
  expect(liveOutputLines("")).toEqual([]);
});
