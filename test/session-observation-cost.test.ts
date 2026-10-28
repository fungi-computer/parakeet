import { CancelledError, QueryClient } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import type { SessionFrame } from "@fungi.computer/shiitake/client";
import type { ParakeetSession } from "../src/session.js";
import { sessionQueryOptions } from "../src/core/session-query.js";
import * as projection from "../src/core/session-projection.js";
import {
  noExtension,
  runningFacts,
  sessionFrame,
  sessionSnapshot,
} from "./fixtures/session.fixture.js";

it("applies each delivered frame once and retains the retry prompt through non-user updates", async () => {
  // Instrument the real projection, not a replacement reducer. Disabling the
  // query cache's deep sharing makes redundant prompt reconstruction visible.
  const apply = vi.spyOn(projection, "applySessionFrame");
  const client = new QueryClient({
    defaultOptions: { queries: { structuralSharing: false } },
  });
  const initial = sessionSnapshot({
    messages: [
      {
        id: "user",
        sequence: 1,
        commandId: "original",
        value: { role: "user", content: "Inspect this", timestamp: 1 },
      },
    ],
    activity: runningFacts(),
  });
  const frames: SessionFrame[] = [];
  let wake: (() => void) | undefined;
  let closed = false;
  const session: ParakeetSession = {
    address: "fixture://observation-cost",
    extension: noExtension,
    command: (): Promise<never> =>
      Promise.reject(new Error("No commands expected")),
    latestPending: () => Promise.resolve(null),
    withdraw: () => Promise.resolve({ status: "unknown" }),
    read: () => Promise.reject(new Error("No history refresh expected")),
    watch: () =>
      Promise.resolve({
        snapshot: initial,
        changes: {
          async *[Symbol.asyncIterator]() {
            while (!closed) {
              const next = frames.shift();
              if (next !== undefined) yield next;
              else
                await new Promise<void>((resolve) => {
                  wake = resolve;
                });
            }
          },
        },
        close: () => {
          closed = true;
          wake?.();
          return Promise.resolve();
        },
      }),
  };
  const options = sessionQueryOptions(session);
  const observing = client.query(options).catch((cause: unknown) => {
    if (!(cause instanceof CancelledError)) throw cause;
  });
  const state = () => client.getQueryData(options.queryKey);
  const deliver = async (frame: SessionFrame) => {
    const previous = state();
    frames.push(frame);
    wake?.();
    await vi.waitFor(() => {
      expect(state()).not.toBe(previous);
    });
  };
  try {
    await vi.waitFor(() => {
      expect(state()?.observation).toBe("live");
    });
    const prompt = state()?.latestPrompt;
    expect(prompt?.text).toBe("Inspect this");
    for (const frame of [
      { kind: "activity", activity: runningFacts({ activeTool: "read" }) },
      {
        kind: "progress",
        activity: runningFacts(),
        progress: {
          messageId: "reply",
          revision: 1,
          text: "Partial",
          thinking: "",
          textTruncated: false,
          thinkingTruncated: false,
        },
      },
      { kind: "tool_output", activity: runningFacts(), toolOutput: [] },
      sessionFrame({
        kind: "update",
        delivery: "live",
        cursor: "non-user",
        messages: [],
        terminals: [],
        pending: initial.pending,
        activity: runningFacts(),
      }),
    ] satisfies SessionFrame[]) {
      await deliver(frame);
      expect.soft(state()?.latestPrompt).toBe(prompt);
    }
    expect(apply).toHaveBeenCalledTimes(4);
    expect(state()?.snapshot?.progress?.text).toBe("Partial");
    await deliver(
      sessionFrame({
        kind: "update",
        delivery: "live",
        cursor: "new-user",
        messages: [
          {
            id: "new-user",
            commandId: "new-command",
            sequence: 2,
            value: { role: "user", content: "Now this", timestamp: 2 },
          },
        ],
        terminals: [],
        pending: initial.pending,
        activity: runningFacts(),
      }),
    );
    expect(state()?.latestPrompt).toMatchObject({
      commandId: "new-command",
      text: "Now this",
    });
    const reset = sessionSnapshot();
    await deliver({
      kind: "reset",
      reason: "history_unavailable",
      cursor: null,
      baseline: reset,
    });
    expect(state()?.snapshot?.messages).toEqual([]);
    expect(state()?.latestPrompt?.text).toBe("Now this");
    expect(apply).toHaveBeenCalledTimes(6);
  } finally {
    await client.cancelQueries(options);
    await observing;
    client.clear();
    apply.mockRestore();
  }
});
