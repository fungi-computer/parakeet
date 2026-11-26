import { expect, it } from "vitest";
import type { ClientEntryV1 } from "@fungi.computer/shiitake/client-entry";
import { ExtensionId } from "@fungi.computer/shiitake/extensions";

import { placeClientTimeline } from "../src/core/client-timeline.js";
import { describeMessages } from "../src/core/describe-timeline.js";
import type { TimelineItem, ToolGroupItem } from "../src/store/types.js";

const group = (id: string): ToolGroupItem => ({
  calls: [],
  failedCount: 0,
  recoveredCount: 0,
  id: `group:${id}`,
  kind: "tool_group",
  status: "completed",
  summary: "",
  tools: [
    {
      args: {},
      id,
      kind: "tool",
      name: "execute",
      status: "completed",
    },
  ],
});

const entry = (
  describeToolCall: NonNullable<ClientEntryV1["describeToolCall"]>,
): ClientEntryV1 => ({
  protocol: "shiitake.client/v1",
  id: ExtensionId.make("asks"),
  describeToolCall,
});

const reasons: [string, unknown][] = [];

it("shows the person's answer to a tool call as their own message after its group", () => {
  const before: TimelineItem = group("call-1");
  const settled = describeMessages(
    [before, group("call-2")],
    [entry((id) => (id === "call-1" ? "Explore" : undefined))],
    {},
    () => undefined,
  );
  // A group of nothing but the answered question gives way to the answer.
  // The answer takes the group's id: cells a client anchored after the group
  // (a goal's "ended" row, say) still find a row to follow.
  expect(settled.map((item) => item.id)).toEqual([
    "group:call-1",
    "group:call-2",
  ]);
  expect(settled[0]).toMatchObject({
    kind: "user_message",
    status: "confirmed",
    text: "Explore",
    outcome: "system",
  });
});

it("marks only the person's own words as their own", () => {
  const settled = describeMessages(
    [group("call-1")],
    [entry(() => ({ text: "Explore", own: true }))],
    {},
    () => undefined,
  );
  expect(settled[0]).toMatchObject({ text: "Explore", outcome: "own" });
});

it("keeps a group that holds other calls and puts the answer after it", () => {
  const mixed: ToolGroupItem = {
    ...group("call-1"),
    tools: [...group("call-1").tools, ...group("call-3").tools],
  };
  const settled = describeMessages(
    [mixed],
    [entry((id) => (id === "call-1" ? "Explore" : undefined))],
    {},
    () => undefined,
  );
  expect(settled.map((item) => item.id)).toEqual([
    "group:call-1",
    "answer:call-1",
  ]);
});

it("leaves the timeline as it is when a description throws, and reports it", () => {
  const items = [group("call-1")];
  const settled = describeMessages(
    items,
    [
      entry(() => {
        throw new Error("boom");
      }),
    ],
    {},
    (entryId, cause) => reasons.push([entryId, cause]),
  );
  expect(settled.map((item) => item.id)).toEqual(["group:call-1"]);
  expect(reasons.map(([entryId]) => entryId)).toEqual(["asks"]);
});

it("shows a parked ask's answer once, at its follow-up message, not also after the call", () => {
  const followUp: TimelineItem = {
    id: "m9",
    kind: "user_message",
    status: "confirmed",
    text: "Answer to ask a1: Selected: Explore",
    origin: { extensionId: "asks", correlation: "a1" },
  };
  const parked: ClientEntryV1 = {
    protocol: "shiitake.client/v1",
    id: ExtensionId.make("asks"),
    // A parked ask's outcome names no tool call, so the call line is empty.
    describeToolCall: () => undefined,
    describeMessage: (from) =>
      from.correlation === "a1" ? { text: "Explore", own: true } : undefined,
  };
  const settled = describeMessages(
    [group("call-1"), followUp],
    [parked],
    {},
    () => undefined,
  );
  expect(settled.map((item) => item.id)).toEqual(["group:call-1", "m9"]);
  expect(settled.filter((item) => item.kind === "user_message")).toHaveLength(
    1,
  );
  expect(settled[1]).toMatchObject({ text: "Explore", outcome: "own" });
});

it("still draws a client row anchored after a group that gave way to its answer", () => {
  const settled = describeMessages(
    [group("call-1")],
    [entry(() => ({ text: "Explore", own: true }))],
    {},
    () => undefined,
  );
  // A goal's "ended" row, anchored after the group's position.
  const placed = placeClientTimeline(
    [
      {
        entryId: "goal",
        value: {
          chips: [],
          panel: [],
          waiting: null,
          timeline: {
            omitted: 0,
            cells: [
              {
                id: "9",
                sequence: 9,
                commandId: null,
                at: 9,
                afterSequence: 4,
                rows: [{ id: "ended", title: "Goal ended" }],
              },
            ],
          },
        },
      },
    ],
    new Map(),
    new Map([[4, "group:call-1"]]),
  );
  const drawn = settled.flatMap((item) => [
    item.id,
    ...(placed.after.get(item.id) ?? []).map(({ cell }) => `cell:${cell.id}`),
  ]);
  expect(drawn).toEqual(["group:call-1", "cell:9"]);
});
