// @vitest-environment jsdom
import { seededAvatar } from "@fungi.computer/sprite/avatar";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";

import { ToolGroup } from "../src/components/ToolGroup.js";
import { initialToolDisclosure } from "../src/core/tool-groups.js";
import { toolCallView } from "../src/core/tool-view.js";
import type { ToolGroupItem, ToolItem } from "../src/store/types.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

function groupFor(name: string, result: string): ToolGroupItem {
  const tool: ToolItem = {
    args: { code: 'return await env.self.rename({name: "Crumb"});' },
    id: "call",
    kind: "tool",
    name,
    startedAt: 1,
    status: "completed",
    result: {
      role: "toolResult",
      toolCallId: "call",
      toolName: name,
      content: [{ type: "text", text: result }],
      isError: false,
      timestamp: 2,
    },
  };
  return {
    calls: [toolCallView(tool)],
    failedCount: 0,
    recoveredCount: 0,
    id: "group",
    kind: "tool_group",
    status: "completed",
    summary: "Renamed itself",
    tools: [tool],
  };
}

function render(group: ToolGroupItem) {
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => {
    root.render(
      <ToolGroup
        group={group}
        disclosure={initialToolDisclosure}
        onToggle={() => undefined}
      />,
    );
  });
  return { container, root };
}

it("draws the renamed Agent's own head, not a Sigil or an image, on its rename row", () => {
  const avatar = seededAvatar("crumb");
  const { container, root } = render(
    groupFor("execute", JSON.stringify({ name: "Crumb", avatar })),
  );
  try {
    expect(container.textContent).toContain("Renamed itself to");
    expect(container.textContent).toContain("Crumb");
    expect(container.querySelector("[data-agent-head]")).not.toBeNull();
    expect(container.querySelector("img")).toBeNull();
  } finally {
    act(() => {
      root.unmount();
    });
  }
});

it("keeps the ordinary tool Sigil on a call that did not rename the Agent", () => {
  const { container, root } = render(
    groupFor("execute", JSON.stringify({ name: "Crumb" })),
  );
  try {
    expect(container.querySelector("[data-agent-head]")).toBeNull();
  } finally {
    act(() => {
      root.unmount();
    });
  }
});
