// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";

import { AnswerWaitContext, ToolGroup } from "../src/components/ToolGroup.js";
import { TimelineItem } from "../src/components/TimelineItem.js";
import { initialToolDisclosure } from "../src/core/tool-groups.js";
import { toolCallView } from "../src/core/tool-view.js";
import type {
  ToolGroupItem,
  ToolItem,
  UserMessageItem,
} from "../src/store/types.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

function mount(node: React.ReactNode) {
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => {
    root.render(node);
  });
  return container;
}

it("draws a described extension message as the person's own message", () => {
  const item: UserMessageItem = {
    id: "m1",
    kind: "user_message",
    status: "confirmed",
    at: 1,
    text: "Work on a project",
    outcome: "own",
    origin: { extensionId: "botanical-session-question", correlation: "a1" },
  };
  const container = mount(
    <TimelineItem
      item={item}
      onToggleTool={() => undefined}
      toolDisclosure={initialToolDisclosure}
    />,
  );
  expect(container.textContent).toBe("Work on a project");
  expect(container.querySelector("[data-question-outcome]")).not.toBeNull();
  // Their own bubble, not the dim system line it used to be.
  expect(container.querySelector(".text-dim")).toBeNull();
});

it.each([
  "An Agent answered: Keep",
  "Nobody answered in time, so nothing was decided",
])("draws %s as a quiet system line, never as the person's message", (text) => {
  const item: UserMessageItem = {
    id: "m2",
    kind: "user_message",
    status: "confirmed",
    at: 1,
    text,
    outcome: "system",
    origin: { extensionId: "botanical-session-question", correlation: "a1" },
  };
  const container = mount(
    <TimelineItem
      item={item}
      onToggleTool={() => undefined}
      toolDisclosure={initialToolDisclosure}
    />,
  );
  expect(container.textContent).toBe(text);
  expect(container.querySelector(".text-dim")).not.toBeNull();
});

function runningAsk(id: string): ToolGroupItem {
  const tool: ToolItem = {
    args: { code: "return await env.question.ask({});" },
    id,
    kind: "tool",
    name: "execute",
    startedAt: 1,
    status: "running",
  };
  return {
    calls: [toolCallView(tool)],
    active: toolCallView(tool),
    failedCount: 0,
    recoveredCount: 0,
    id: `g-${id}`,
    kind: "tool_group",
    status: "running",
    summary: "Ran a script",
    tools: [tool],
  };
}

it("says a call is waiting for your answer only when its own card is open", () => {
  const view = (open: readonly string[], call: string) =>
    mount(
      <AnswerWaitContext.Provider value={new Set(open)}>
        <ToolGroup
          group={runningAsk(call)}
          disclosure={initialToolDisclosure}
          onToggle={() => undefined}
        />
      </AnswerWaitContext.Provider>,
    ).textContent;
  expect(view(["call-1"], "call-1")).toContain("Waiting for your answer");
  // Another call that merely looks like a question is not the one waiting.
  expect(view(["call-2"], "call-1")).toContain("Running script");
  expect(view([], "call-1")).toContain("Running script");
});
