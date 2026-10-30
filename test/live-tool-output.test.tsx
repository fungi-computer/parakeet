import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ParakeetProvider, useTimeline } from "../src/headless.js";
import { TimelineItem } from "../src/components/TimelineItem.js";
import {
  initialToolDisclosure,
  toggleDisclosure,
} from "../src/core/tool-groups.js";
import type { ParakeetSession } from "../src/session.js";
import type { SessionFrame } from "@fungi.computer/shiitake/client";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});
import {
  commandHandler,
  commandResult,
  noExtension,
  runningFacts,
  sessionSnapshot,
} from "./fixtures/session.fixture.js";

function Rows() {
  const timeline = useTimeline();
  const [disclosure, setDisclosure] = useState(initialToolDisclosure);
  return timeline.settled.map((item) => (
    <TimelineItem
      item={item}
      key={item.id}
      toolDisclosure={disclosure}
      onToggleTool={(id, defaultOpen) => {
        setDisclosure((state) => toggleDisclosure(state, id, defaultOpen));
      }}
    />
  ));
}

it("a running call shows its last six live lines folded and the whole tail when opened", async () => {
  const snapshot = sessionSnapshot({
    activity: runningFacts({ activeTool: "execute" }),
    messages: [
      {
        id: "prompt",
        commandId: "running-command",
        sequence: 1,
        value: { role: "user", content: "Build it", timestamp: 1 },
      },
      {
        id: "assistant",
        commandId: "running-command",
        sequence: 2,
        value: {
          role: "assistant",
          api: "pi",
          provider: "faux",
          model: "faux",
          content: [
            {
              type: "toolCall",
              id: "build",
              name: "execute",
              arguments: {
                code: "return await env.computers.local.exec({command:'build'});",
              },
            },
          ],
          stopReason: "toolUse",
          timestamp: 2,
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              total: 0,
            },
          },
        },
      },
    ],
    toolOutput: [
      {
        toolCallId: "build",
        revision: 1,
        droppedBytes: 2048,
        totalBytes: 4096,
        tail: "step one\nstep two\nstep three\nstep four\nstep five\nstep six\nstep seven\nstep eight\n",
      },
    ],
  });
  let finishWatch: ((result: IteratorResult<SessionFrame>) => void) | undefined;
  const next = new Promise<IteratorResult<SessionFrame>>((resolve) => {
    finishWatch = resolve;
  });
  const session: ParakeetSession = {
    address: "test://live-tool-output",
    latestPending: () => Promise.resolve(null),
    withdraw: () => Promise.resolve({ status: "unknown" }),
    command: commandHandler(commandResult),
    extension: noExtension,
    read: () => Promise.resolve(snapshot),
    watch: () =>
      Promise.resolve({
        snapshot,
        changes: {
          [Symbol.asyncIterator]: () => ({ next: () => next }),
        },
        close: () => {
          finishWatch?.({ done: true, value: undefined });
          return Promise.resolve();
        },
      }),
  };
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <ParakeetProvider session={session}>
            <Rows />
          </ParakeetProvider>
        </QueryClientProvider>,
      );
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(container.textContent).toContain("step eight");
    });
    expect(container.textContent).not.toContain("step one");
    expect(container.textContent).not.toContain("step two");
    expect(container.textContent).toContain("step three");
    expect(container.textContent).not.toContain("… 2 KiB earlier");
    const toggle = container.querySelector("button[aria-expanded=false]");
    expect(toggle).not.toBeNull();
    act(() => {
      toggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.textContent).toContain("step one");
    expect(container.textContent).toContain("step eight");
    expect(container.textContent).toContain("… 2 KiB earlier");
  } finally {
    act(() => {
      root.unmount();
    });
    client.clear();
    container.remove();
  }
});
