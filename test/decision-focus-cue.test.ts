import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

const css = readFileSync(join(process.cwd(), "src/styles.css"), "utf8");

it("never rings the first option while nothing is highlighted, so the cue is not a preselection", () => {
  // A ring on the first (recommended) row would read as a chosen answer.
  expect(css).not.toMatch(/\[role="option"\]:first-child/u);
  // Focus with no highlight is a quiet outline on the whole list instead.
  expect(css).toMatch(
    /parakeet-decision-list:focus-visible:not\(:has\(\[data-highlight\]\)\)\s*\{[^}]*outline:/u,
  );
  // The ring that remains is on the highlighted row.
  expect(css).toMatch(
    /\[role="option"\]:has\(\[data-highlight\]\)\s*\{[^}]*box-shadow: inset 0 0 0 2px var\(--caps-focus-ring\)/u,
  );
});
