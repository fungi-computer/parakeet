import { expect, it } from "vitest";
import { proveToolOutput } from "../../shiitake/test/fixtures/tool-output-coordinator.fixture.js";
import { applySessionFrame } from "../src/core/session-projection.js";

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
  });
});
