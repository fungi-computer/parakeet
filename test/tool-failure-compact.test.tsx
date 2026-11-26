// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";

import { ToolGroup } from "../src/components/ToolGroup.js";
import { initialToolDisclosure, toolGroup } from "../src/core/tool-groups.js";
import type { ToolItem } from "../src/store/types.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const reason = "Patch hunk does not match AGENTS.md.";

function tool(id: string, name: string, failed: boolean, at: number): ToolItem {
  return {
    args:
      name === "apply_patch"
        ? {
            patch: "*** Begin Patch\n*** Update File: AGENTS.md\n*** End Patch",
          }
        : { code: "return await env.files.list({path: '.'});" },
    id,
    kind: "tool",
    name,
    startedAt: at,
    status: failed ? "error" : "completed",
    result: {
      role: "toolResult",
      toolCallId: id,
      toolName: name,
      isError: failed,
      timestamp: at + 100,
      content: [{ type: "text", text: failed ? reason : "[]" }],
    },
  };
}

function render(tools: readonly [ToolItem, ...ToolItem[]]) {
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => {
    root.render(
      <ToolGroup
        group={toolGroup(tools)}
        disclosure={initialToolDisclosure}
        onToggle={() => undefined}
      />,
    );
  });
  return container;
}

it("folds a failed call the run went past into a compact row with its status dot", () => {
  const container = render([
    tool("p1", "apply_patch", true, 1),
    tool("s1", "execute", false, 500),
  ]);
  // The failure is a row, not a red block: its reason stays folded away.
  expect(container.textContent).not.toContain(reason);
  expect(container.textContent).toContain("failed");
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it("still opens a failure that nothing went past", () => {
  const container = render([
    tool("s1", "execute", false, 1),
    tool("p1", "apply_patch", true, 500),
  ]);
  expect(container.textContent).toContain(reason);
});

it("never claims success for a failed call, in its row or in the summary", () => {
  const group = toolGroup([
    tool("p1", "apply_patch", true, 1),
    tool("s1", "execute", false, 500),
  ]);
  const [failed, done] = group.calls;
  expect(failed?.verb).toBe("Couldn't update");
  expect(done?.verb).not.toMatch(/Couldn't/u);
  // The summary names the failure instead of counting an edit as done.
  expect(group.summary).toBe("Ran 1 script, 1 edit failed");
  expect(group.summary).not.toMatch(/edited/iu);
  const container = render([
    tool("p1", "apply_patch", true, 1),
    tool("s1", "execute", false, 500),
  ]);
  expect(container.textContent).toContain("Couldn't update");
  expect(container.textContent).not.toContain("Updated");
  expect(container.textContent).not.toContain("Edited");
  // A lone failed call reads as a failure too.
  expect(toolGroup([tool("p2", "apply_patch", true, 1)]).summary).toMatch(
    /^Couldn't update/u,
  );
});
