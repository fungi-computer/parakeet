// @vitest-environment jsdom
import { awaitingFixtures } from "@fungi.computer/parakeet-testing";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";

import { decisionView, decisionViewText } from "../src/core/awaiting-answer.js";
import { DecisionPanel } from "../src/components/DecisionComposer.js";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});

const squash = (text: string) => text.replace(/\s+/gu, " ").trim();

for (const fixture of awaitingFixtures)
  it(`the web composer draws exactly decisionView for ${fixture.name}`, async () => {
    const view = decisionView(fixture.state, fixture.prompt, {
      kind: fixture.kind,
      position: fixture.position,
      total: fixture.total,
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => {
        root.render(
          <DecisionPanel
            view={view}
            dispatch={() => undefined}
            onLater={() => undefined}
            takeFocus={false}
          />,
        );
        await Promise.resolve();
      });
      const group = container.querySelector('[role="group"]');
      expect(group?.getAttribute("aria-label")).toBe(view.label);
      const surface = squash(group?.textContent ?? "");
      let from = 0;
      // A multiple decision draws its `[x]` / `[ ]` markers as Caps checks.
      const drawn = (row: (typeof view.rows)[number]) =>
        view.multiple ? row.caption : row.text;
      const texts = new Map(view.rows.map((row) => [row.text, drawn(row)]));
      for (const listed of decisionViewText(view)) {
        const token = texts.get(listed) ?? listed;
        if (token === view.other?.text && token !== "") continue;
        const at = surface.indexOf(squash(token), from);
        expect(
          at,
          `"${token}" after offset ${String(from)} in "${surface}"`,
        ).toBeGreaterThanOrEqual(0);
        from = at + squash(token).length;
      }
      const typed = group?.querySelector<HTMLInputElement>(
        'input:not([type="checkbox"])',
      );
      expect(typed?.value ?? "").toBe(view.other?.text ?? "");
      const highlighted = [
        ...(group?.querySelectorAll("[data-highlight]") ?? []),
      ];
      // Block-level lines, so adjacent text runs without a space in textContent.
      const unspaced = (text: string) => text.replace(/\s+/gu, "");
      expect(highlighted.map((node) => unspaced(node.textContent))).toEqual(
        view.rows
          .filter((row) => row.highlighted)
          .map((row) => unspaced(`${drawn(row)}${row.description ?? ""}`)),
      );
      const checks = [
        ...(group?.querySelectorAll<HTMLInputElement>(
          'input[type="checkbox"]',
        ) ?? []),
      ];
      expect(checks.map((box) => box.checked)).toEqual(
        view.multiple ? view.rows.map((row) => row.toggled) : [],
      );
      const send = [...container.querySelectorAll("button")].find(
        (button) => button.textContent === "Send",
      );
      expect(send?.disabled).toBe(!view.canSend);
    } finally {
      act(() => {
        root.unmount();
      });
      container.remove();
    }
  });
