// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { seededAvatar } from "@fungi.computer/sprite/avatar";

import { toolGroup } from "../src/core/tool-groups.js";
import type { TimelineItem, ToolItem } from "../src/store/types.js";
import { useAgentRenamed } from "../src/use-agent-renamed.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

function rename(
  id: string,
  code = 'return await env.self.rename({name: "Moss"});',
): TimelineItem {
  const tool: ToolItem = {
    args: { code },
    id,
    kind: "tool",
    name: "execute",
    startedAt: 1,
    status: "completed",
    result: {
      role: "toolResult",
      toolCallId: id,
      toolName: "execute",
      content: [
        {
          type: "text",
          text: JSON.stringify({ name: "Moss", avatar: seededAvatar("moss") }),
        },
      ],
      isError: false,
      timestamp: 2,
    },
  };
  return toolGroup([tool]);
}

function Probe(props: {
  items: readonly TimelineItem[];
  onRenamed: () => void;
}) {
  useAgentRenamed(props.items, props.onRenamed);
  return null;
}

it("tells the host about a rename that happens while open, not one in history", () => {
  let calls = 0;
  const onRenamed = () => {
    calls += 1;
  };
  const root = createRoot(document.createElement("div"));
  const draw = (items: readonly TimelineItem[]) => {
    act(() => {
      root.render(<Probe items={items} onRenamed={onRenamed} />);
    });
  };
  draw([rename("old")]);
  expect(calls).toBe(0);
  draw([rename("old")]);
  expect(calls).toBe(0);
  draw([rename("old"), rename("new")]);
  expect(calls).toBe(1);
  draw([rename("old"), rename("new")]);
  expect(calls).toBe(1);
  // A rename inside a longer script is still a rename.
  draw([
    rename("old"),
    rename("new"),
    rename(
      "long",
      'const r = await env.self.rename({name: "Moss"}); await files.list({path: "."}); return r;',
    ),
  ]);
  expect(calls).toBe(2);
});
