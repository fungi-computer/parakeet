// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { TimelineItem } from "../src/components/TimelineItem.js";
import {
  ParakeetHostFactsContext,
  plainModelFailure,
  type ParakeetHostFacts,
} from "../src/host-facts.js";
import type { TimelineItem as Row } from "../src/store/types.js";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
  writable: true,
});

const containers: HTMLElement[] = [];
afterEach(() => {
  for (const container of containers.splice(0)) container.remove();
});

function render(facts: ParakeetHostFacts, node: React.ReactNode) {
  const container = document.createElement("div");
  document.body.append(container);
  containers.push(container);
  act(() => {
    createRoot(container).render(
      <ParakeetHostFactsContext.Provider value={facts}>
        {node}
      </ParakeetHostFactsContext.Provider>,
    );
  });
  return container;
}

const failedText =
  "Model request failed (provider_unavailable). Retry the request.";
const failedRun: Row = {
  id: "error-0",
  kind: "assistant_message",
  isError: true,
  pending: false,
  at: 1,
  text: failedText,
  usage: { cost: 0, tokens: 0 },
  providerError: "diagnostic",
  repeatCount: 4,
};

it("names the cause of a model failure in plain words and never shows the code", () => {
  expect(plainModelFailure(failedText)).toEqual({
    unreachable: true,
    message: "Couldn’t reach the model",
    detail: failedText,
  });
  expect(
    plainModelFailure("Model request failed (provider_rejected)."),
  ).toEqual({
    unreachable: false,
    message: "The model request failed",
    detail: "Model request failed (provider_rejected).",
  });
  expect(plainModelFailure("Something else broke.")).toBeUndefined();
});

it("folds four identical failures into one line with a count and no raw code", () => {
  const container = render({}, <TimelineItem item={failedRun} />);
  expect(container.querySelectorAll(".caps-failure-line")).toHaveLength(1);
  expect(container.querySelector(".caps-failure-line")?.textContent).toContain(
    "Couldn’t reach the model · 4 tries",
  );
  expect(container.textContent).not.toContain("x4");
  // The raw code lives only behind the details disclosure.
  expect(
    container.querySelector(".caps-failure-line")?.textContent,
  ).not.toContain("provider_unavailable");
  expect(container.querySelector("details")?.textContent).toContain(
    "provider_unavailable",
  );
});

it("leaves a no-model failure to the composer's setup notice", () => {
  const container = render(
    {
      modelSetup: {
        state: "missing",
        fix: { label: "Add a model key", onSelect: vi.fn() },
      },
    },
    <TimelineItem item={failedRun} />,
  );
  expect(container.textContent).toBe("");
});
