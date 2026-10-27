// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { RunFailureNotice } from "../src/components/RunFailureNotice.js";
import { sessionViewState } from "../src/core/session-view-state.js";
import { sessionSnapshot } from "./fixtures/session.fixture.js";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
  writable: true,
});

it("does not display credentials or internal IDs from terminal diagnostics", () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    act(() => {
      root.render(
        <RunFailureNotice
          failure="failed"
          cause="reason_unavailable: run=mule_run_private123; provider=workers-ai; model=kimi"
          onRetry={vi.fn()}
        />,
      );
    });
    expect(container.textContent).not.toContain("mule_run_private123");
    expect(container.textContent).not.toContain("reason_unavailable");
    expect(
      container.querySelector('[aria-label="Retry prompt"]'),
    ).not.toBeNull();

    act(() => {
      root.render(
        <RunFailureNotice
          failure="interrupted"
          cause="Authorization: Bearer synthetic-private-token; session=session-private123"
          onRetry={vi.fn()}
        />,
      );
    });
    expect(container.textContent).not.toContain("synthetic-private-token");
    expect(container.textContent).not.toContain("session-private123");
    expect(
      container.querySelector('[aria-label="Retry prompt"]'),
    ).not.toBeNull();

    act(() => {
      root.render(
        <RunFailureNotice
          failure="failed"
          cause="Authorization: Bearer synthetic-private-token"
          onRetry={vi.fn()}
        />,
      );
    });
    expect(container.textContent).toContain("Bearer [redacted]");
    expect(container.textContent).not.toContain("synthetic-private-token");
  } finally {
    act(() => {
      root.unmount();
    });
  }
});

it("describes interruption without denying a possible earlier assistant response", () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    act(() => {
      root.render(
        <RunFailureNotice
          failure="interrupted"
          cause="Restart recovery budget exhausted (2 recoveries)"
          onRetry={vi.fn()}
        />,
      );
    });
    expect(container.textContent).toContain(
      "This turn stopped before it finished: Restart recovery budget exhausted (2 recoveries)",
    );
    expect(container.textContent).not.toContain("The model didn't respond");
  } finally {
    act(() => {
      root.unmount();
    });
  }
});

it("redacts a credential crossing the Session display cut before rendering the failure notice", () => {
  const snapshot = sessionSnapshot({
    terminals: [
      {
        commandId: "original-command",
        outcome: "failed",
        sequence: 2,
        diagnostic: `${"x ".repeat(95)}sk-live-0123456789abcdefghijklmnop`,
      },
    ],
  });
  const view = sessionViewState(snapshot);
  if (view.kind !== "error") throw new Error("Expected terminal failure");

  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    act(() => {
      root.render(
        <RunFailureNotice
          failure="failed"
          cause={view.cause}
          onRetry={vi.fn()}
        />,
      );
    });
    expect(container.textContent).not.toContain("sk-live-01");
    expect(container.textContent).toContain("[redacted]");
  } finally {
    act(() => {
      root.unmount();
    });
  }
});
