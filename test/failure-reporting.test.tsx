import { inspect } from "node:util";
import * as Redacted from "effect/Redacted";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { CodeBlock } from "../src/components/CodeBlock.js";
import { reportFailure } from "../src/lib/failure.js";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
  writable: true,
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

it("retains the original nested cause at the logger without rendering its contents", () => {
  const report = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const nested = new Error("synthetic-private-nested-cause");
  const cause = new Error("synthetic-private-top-cause", { cause: nested });
  reportFailure("fixture operation", cause);
  const args = report.mock.calls[0];
  const retained: unknown = args?.[1];
  expect(Redacted.isRedacted(retained)).toBe(true);
  if (!Redacted.isRedacted(retained)) throw new Error("Missing redacted cause");
  expect(Redacted.value(retained)).toBe(cause);
  expect(cause.cause).toBe(nested);
  for (const rendered of [JSON.stringify(args), String(args), inspect(args)]) {
    expect(rendered).not.toContain(cause.message);
    expect(rendered).not.toContain(nested.message);
  }
});

it("shows clipboard failure and reports its original cause", async () => {
  const report = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const cause = new Error("clipboard permission denied");
  vi.stubGlobal("navigator", {
    clipboard: { writeText: () => Promise.reject(cause) },
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    act(() => {
      root.render(<CodeBlock content="fixture" />);
    });
    const button = container.querySelector("button");
    if (!button) throw new Error("Copy button missing");
    await act(() => {
      button.click();
      return Promise.resolve();
    });
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "Copy to clipboard failed.",
    );
    const retained: unknown = report.mock.calls[0]?.[1];
    expect(Redacted.isRedacted(retained)).toBe(true);
    if (!Redacted.isRedacted(retained))
      throw new Error("Missing clipboard cause");
    expect(Redacted.value(retained)).toBe(cause);
  } finally {
    act(() => {
      root.unmount();
    });
  }
});
