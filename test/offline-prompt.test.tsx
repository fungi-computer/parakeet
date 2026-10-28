// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import {
  ParakeetProvider,
  useComposer,
  useLastSessionReplyAt,
  useStatus,
  useTimeline,
} from "../src/headless.js";
import type { ParakeetSession } from "../src/session.js";
import type { SessionFrame } from "@fungi.computer/shiitake/client";
import {
  accepted,
  commandHandler,
  noExtension,
  sessionSnapshot,
} from "./fixtures/session.fixture.js";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});

it.each(["unavailable", "connecting"] as const)(
  "holds one dimmed %s prompt and admits it once after a fresh watch snapshot",
  async (outage) => {
    const snapshots = sessionSnapshot();
    let rejectLost: ((cause: Error) => void) | undefined;
    const lost = new Promise<IteratorResult<SessionFrame>>(
      (_resolve, reject) => {
        rejectLost = reject;
      },
    );
    let opens = 0;
    let reopen: (() => void) | undefined;
    const reopened = new Promise<void>((resolve) => {
      reopen = resolve;
    });
    const sent: string[] = [];
    const session: ParakeetSession = {
      address: "test://offline-prompt",
      extension: noExtension,
      command: commandHandler((input) => {
        sent.push(input.requestId);
        return Promise.resolve(accepted("offline-command"));
      }),
      read: () => Promise.resolve(snapshots),
      latestPending: () => Promise.resolve(null),
      withdraw: () => Promise.resolve({ status: "unknown" }),
      watch: async () => {
        opens += 1;
        if (opens > 1) await reopened;
        const next =
          opens === 1
            ? () => lost
            : () => new Promise<IteratorResult<SessionFrame>>(() => undefined);
        return Promise.resolve({
          snapshot: snapshots,
          changes: {
            [Symbol.asyncIterator]: () => ({
              next,
            }),
          },
          close: () => Promise.resolve(),
        });
      },
    };
    let composer: ReturnType<typeof useComposer> | undefined;
    let status: ReturnType<typeof useStatus> | undefined;
    let lastReplyAt: number | undefined;
    let tail: ReturnType<typeof useTimeline>["tail"] = [];
    function Probe() {
      composer = useComposer();
      status = useStatus();
      lastReplyAt = useLastSessionReplyAt();
      tail = useTimeline().tail;
      return null;
    }
    const root = createRoot(document.createElement("div"));
    const client = new QueryClient();
    try {
      await act(async () => {
        root.render(
          <QueryClientProvider client={client}>
            <ParakeetProvider session={session}>
              <Probe />
            </ParakeetProvider>
          </QueryClientProvider>,
        );
        await Promise.resolve();
      });
      await vi.waitFor(() => {
        expect(status?.observation.status).toBe("live");
      });
      expect(lastReplyAt).toBeGreaterThan(0);
      const deliveredAt = lastReplyAt;
      if (deliveredAt === undefined)
        throw new Error("Watch did not deliver its snapshot");
      if (rejectLost === undefined) throw new Error("Watch did not register");
      const loseWatch = rejectLost;
      await act(async () => {
        loseWatch(new Error("watch lost"));
        await Promise.resolve();
      });
      await vi.waitFor(() => {
        expect(status?.observation.status).toBe("unavailable");
      });
      expect(lastReplyAt).toBe(deliveredAt);
      let reconnecting: Promise<unknown> | undefined;
      if (outage === "connecting") {
        act(() => {
          reconnecting = status?.reconnect();
        });
        await vi.waitFor(() => {
          expect(status?.observation.status).toBe("connecting");
        });
      }
      await act(async () => {
        composer?.setDraft("Keep this one");
        composer?.send();
        await Promise.resolve();
      });
      expect(sent).toEqual([]);
      expect(tail).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "user_message",
            text: "Keep this one",
            status: "queued",
          }),
        ]),
      );
      expect(composer?.draft).toBe("");
      act(() => {
        composer?.setDraft("Keep editing");
        composer?.send();
      });
      expect(sent).toEqual([]);
      expect(composer?.draft).toBe("Keep editing");
      expect(composer?.admissionError).toBe("offline_queue_full");
      await act(async () => {
        reopen?.();
        await (reconnecting ?? status?.reconnect());
      });
      await vi.waitFor(() => {
        expect(sent).toHaveLength(1);
      });
      expect(lastReplyAt).toBeGreaterThanOrEqual(deliveredAt);
      expect(opens).toBe(2);
      expect(composer?.draft).toBe("Keep editing");
      expect(composer?.admissionError).toBeUndefined();
    } finally {
      act(() => {
        root.unmount();
      });
      client.clear();
      localStorage.clear();
    }
  },
);
