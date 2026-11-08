// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { RunFailureNotice } from "../src/components/RunFailureNotice.js";
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
    message: "The model provider couldn't be reached. Try again.",
  });
  expect(
    plainModelFailure("Model request failed (provider_rejected)."),
  ).toEqual({
    unreachable: false,
    message: "The model request failed. Try again.",
  });
  expect(plainModelFailure("Something else broke.")).toBeUndefined();
});

it("folds four identical failures into one line with a count and no raw code", () => {
  const container = render({}, <TimelineItem item={failedRun} />);
  expect(container.querySelectorAll(".caps-failure-line")).toHaveLength(1);
  expect(container.textContent).toContain("Failed 4 times");
  expect(container.textContent).not.toContain("provider_unavailable");
});

it("shows the setup notice with its fix when no model is connected", () => {
  const onSelect = vi.fn();
  const container = render(
    {
      modelSetup: {
        state: "missing",
        fix: { label: "Add a model key", onSelect },
      },
    },
    <TimelineItem item={failedRun} />,
  );
  expect(container.textContent).toContain("No model could answer");
  expect(container.textContent).not.toContain("provider_unavailable");
  const fix = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Add a model key",
  );
  act(() => fix?.click());
  expect(onSelect).toHaveBeenCalledOnce();
});

it("leaves the composer notice to the timeline when no model is connected, and drops credits with no billing", () => {
  const modelSetup = {
    state: "missing" as const,
    fix: { label: "Add a model key", onSelect: vi.fn() },
  };
  const quiet = render(
    { modelSetup },
    <RunFailureNotice failure="failed" onRetry={vi.fn()} />,
  );
  expect(quiet.textContent).toBe("");
  const admission = render(
    { modelSetup },
    <RunFailureNotice failure="admission" onRetry={vi.fn()} />,
  );
  expect(admission.textContent).toContain("No model could answer");

  const withBilling = render(
    {},
    <RunFailureNotice failure="failed" onRetry={vi.fn()} />,
  );
  expect(withBilling.textContent).toContain("no charge");
  const noBilling = render(
    { billing: false },
    <RunFailureNotice failure="failed" onRetry={vi.fn()} />,
  );
  expect(noBilling.textContent).not.toContain("charge");
  expect(noBilling.textContent).not.toContain("credits");
});
