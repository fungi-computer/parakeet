// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it } from "vitest";
import { Parakeet } from "../src/index.js";
import { inspectionFixture } from "./fixtures/inspection.fixture.js";
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  value: true,
  configurable: true,
});
it("keeps the browser checklist collapsed until its real command succeeds, and dismisses it locally", async () => {
  const fixture = inspectionFixture();
  const query = new QueryClient();
  const node = document.createElement("div");
  document.body.append(node);
  const root = createRoot(node);
  try {
    await act(async () => {
      root.render(
        <QueryClientProvider client={query}>
          <Parakeet session={fixture.session} clients={fixture.clients} />
        </QueryClientProvider>,
      );
      await Promise.resolve();
    });
    await expect.poll(() => node.textContent).toContain("Wire the door");
    expect(node.textContent).not.toContain("Trace the owner");
    const textarea = node.querySelector("textarea");
    if (textarea === null) throw new Error("Missing composer");
    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set?.call(textarea, "/inspect");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
      await Promise.resolve();
    });
    await expect
      .poll(() => node.querySelector("[data-client-inspection]")?.textContent)
      .toContain("Trace the owner");
    expect(fixture.calls).toEqual(["inspect"]);
    expect(
      node.querySelectorAll('[data-client-inspection] [data-glyph="dot"]'),
    ).toHaveLength(5);
    const close = node.querySelector<HTMLButtonElement>(
      "[data-client-inspection] button",
    );
    if (close === null) throw new Error("Missing close control");
    act(() => {
      close.click();
    });
    expect(node.querySelector("[data-client-inspection]")).toBeNull();
  } finally {
    act(() => {
      root.unmount();
    });
    query.clear();
    node.remove();
  }
});
