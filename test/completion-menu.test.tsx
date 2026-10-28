// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import {
  CompletionMenu,
  completionFieldProps,
  completionKeyAction,
} from "../src/components/CompletionMenu.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
let root: Root | undefined;
afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = undefined;
  document.body.replaceChildren();
});

it("reads keys the same way for every completion menu", () => {
  const read = (key: string, shiftKey = false) =>
    completionKeyAction({ key, shiftKey });
  expect(read("ArrowDown")).toBe("next");
  expect(read("ArrowUp")).toBe("previous");
  expect(read("Enter")).toBe("accept");
  expect(read("Tab")).toBe("accept");
  expect(read("Escape")).toBe("dismiss");
  expect(read("Enter", true)).toBeNull();
  expect(read("a")).toBeNull();
});

it("points the text field at the highlighted row", () => {
  expect(
    completionFieldProps({ open: true, listId: "l", selected: 2 }),
  ).toEqual({
    role: "combobox",
    "aria-autocomplete": "list",
    "aria-expanded": true,
    "aria-controls": "l",
    "aria-activedescendant": "l-2",
  });
  expect(
    completionFieldProps({ open: false, listId: "l", selected: 2 })[
      "aria-activedescendant"
    ],
  ).toBeUndefined();
});

it("draws listbox rows, marks the highlight and reports pointer use", () => {
  const onChoose = vi.fn();
  const onHighlight = vi.fn();
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root?.render(
      <CompletionMenu
        open
        rows={[
          { key: "a", label: "/a", detail: "First" },
          { key: "b", label: "/b", detail: "Second", keys: "Ctrl+B" },
        ]}
        selected={1}
        listId="menu"
        label="Commands"
        kind="commands"
        onHighlight={onHighlight}
        onChoose={onChoose}
      />,
    );
  });
  const options = [...host.querySelectorAll('[role="option"]')];
  expect(
    host.querySelector('[role="listbox"]')?.getAttribute("aria-label"),
  ).toBe("Commands");
  expect(options.map((option) => option.id)).toEqual(["menu-0", "menu-1"]);
  expect(options.map((option) => option.getAttribute("aria-selected"))).toEqual(
    ["false", "true"],
  );
  const first = options[0];
  if (!(first instanceof HTMLElement)) throw new Error("row missing");
  act(() => {
    first.click();
  });
  expect(onChoose).toHaveBeenCalledWith(0);
});
