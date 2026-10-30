import { expect, it } from "vitest";
import { proveToolOutput } from "../../shiitake/test/fixtures/tool-output-coordinator.fixture.js";
import { applySessionFrame } from "../src/core/session-projection.js";
import { buildDurableTimeline } from "../src/core/build-timeline.js";
import { overlayToolOutput } from "../src/core/tool-groups.js";

it("joins real Mule tails to the provider call and filters late output after its durable result", async () => {
  await proveToolOutput((live, settled) => {
    const slot = live.toolOutput[0];
    if (slot === undefined) throw new Error("Missing live tail");
    const calls = live.messages.flatMap((message) =>
      message.value.role === "assistant"
        ? message.value.content.filter((content) => content.type === "toolCall")
        : [],
    );
    expect(calls.some((call) => call.id === slot.toolCallId)).toBe(true);
    const frame = {
      kind: "tool_output",
      activity: live.activity,
      toolOutput: live.toolOutput,
    } as const;
    expect(applySessionFrame(live, frame).toolOutput).toEqual([slot]);
    expect(applySessionFrame(settled, frame).toolOutput).toEqual([]);
    const durable = buildDurableTimeline(live.messages, [], live.activity);
    const overlaid = overlayToolOutput(durable.items, live.toolOutput);
    const group = overlaid.find((item) => item.kind === "tool_group");
    expect(group?.tools[0]?.live).toEqual({
      lines: ["step 100"],
      droppedBytes: 0,
      revision: slot.revision,
    });
    expect(group?.calls[0]?.live).toBe(group?.tools[0]?.live);
    expect(overlaid[0]).toBe(durable.items[0]);
    expect(
      durable.items.find((item) => item.kind === "tool_group")?.tools[0]?.live,
    ).toBeUndefined();
    const stale = applySessionFrame(live, {
      ...frame,
      toolOutput: [{ ...slot, revision: slot.revision - 1, tail: "stale" }],
    });
    expect(overlayToolOutput(durable.items, stale.toolOutput)).toEqual(
      overlaid,
    );
    expect(overlayToolOutput(durable.items, [])).toBe(durable.items);
    const completed = buildDurableTimeline(
      settled.messages,
      [],
      settled.activity,
    );
    expect(
      overlayToolOutput(completed.items, live.toolOutput).find(
        (item) => item.kind === "tool_group",
      )?.calls[0]?.live,
    ).toBeUndefined();
  });
});
