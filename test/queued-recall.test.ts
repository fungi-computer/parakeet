import { afterEach, expect, it, vi } from "vitest";
import type {
  CancelResult,
  SessionPendingPrompt,
} from "@fungi.computer/shiitake/client";
import {
  createQueuedRecall,
  type QueuedRecallState,
} from "../src/core/queued-recall.js";

function deferred<T>() {
  let complete: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    complete = resolve;
  });
  return {
    promise,
    resolve(value: T) {
      if (complete === undefined)
        throw new Error("Promise was not initialized");
      complete(value);
    },
  };
}

const newest: SessionPendingPrompt = {
  commandId: "B",
  requestId: "request-B",
  text: "exact text\n",
  delivery: "steer",
  images: [{ type: "image", data: "aGVsbG8=", mimeType: "image/png" }],
};

function fixture() {
  let revision: number | undefined = 0;
  const session = {
    latestPending: vi.fn((): Promise<SessionPendingPrompt | null> =>
      Promise.resolve(newest),
    ),
    cancel: vi.fn((): Promise<CancelResult> =>
      Promise.resolve({
        commandId: "B",
        status: "accepted",
      }),
    ),
  };
  const restore = vi.fn(
    (_prompt: SessionPendingPrompt, expectedRevision: number) => {
      if (revision !== expectedRevision) return false;
      revision = undefined;
      return true;
    },
  );
  const onState = vi.fn<(state: QueuedRecallState) => void>();
  const recall = createQueuedRecall({
    session,
    recovery: undefined,
    reserve: vi.fn(),
    forget: vi.fn(),
    emptyDraftRevision: () => revision,
    restore,
    onState,
  });
  return {
    session,
    restore,
    recall,
    onState,
    setRevision(value: number | undefined) {
      revision = value;
    },
  };
}

afterEach(() => vi.useRealTimers());

it("reserves the composer and restores the exact newest payload only after pending-only cancellation", async () => {
  const f = fixture();
  expect(await f.recall.recall()).toBe("restored");
  expect(f.session.cancel).toHaveBeenCalledExactlyOnceWith({
    commandId: "B",
    onlyIfPending: true,
  });
  expect(f.restore).toHaveBeenCalledExactlyOnceWith(newest, 0);
  expect(await f.recall.recall()).toBe("ignored");
  expect(f.onState.mock.calls.map(([state]) => state.kind)).toEqual([
    "recalling",
    "restored",
  ]);
});

it("does nothing when the composer has a draft, attachments or a pending paste", async () => {
  const f = fixture();
  f.setRevision(undefined);
  expect(await f.recall.recall()).toBe("ignored");
  expect(f.session.latestPending).not.toHaveBeenCalled();
  expect(f.session.cancel).not.toHaveBeenCalled();
});

it("lets the host preserve native/history handling when no own pending prompt exists", async () => {
  const f = fixture();
  f.session.latestPending.mockResolvedValue(null);
  expect(await f.recall.recall()).toBe("empty");
  expect(f.session.cancel).not.toHaveBeenCalled();
  expect(f.recall.state.kind).toBe("idle");
});

it("ignores repeated Up while one lookup/cancellation is in flight", async () => {
  const f = fixture();
  const pending = deferred<SessionPendingPrompt | null>();
  f.session.latestPending.mockReturnValue(pending.promise);
  const first = f.recall.recall();
  expect(await f.recall.recall()).toBe("ignored");
  pending.resolve(newest);
  expect(await first).toBe("restored");
  expect(f.session.latestPending).toHaveBeenCalledTimes(1);
  expect(f.session.cancel).toHaveBeenCalledTimes(1);
});

it("does not withdraw a prompt when the draft changed during lookup", async () => {
  const f = fixture();
  const pending = deferred<SessionPendingPrompt | null>();
  f.session.latestPending.mockReturnValue(pending.promise);
  const first = f.recall.recall();
  f.setRevision(1);
  pending.resolve(newest);
  expect(await first).toBe("ignored");
  expect(f.session.cancel).not.toHaveBeenCalled();
});

it("reports the exact TooLate notice without restoring or changing history", async () => {
  const f = fixture();
  f.session.cancel.mockImplementation(() =>
    Promise.resolve({
      commandId: "B",
      status: "too_late",
    }),
  );
  expect(await f.recall.recall()).toBe("too_late");
  expect(f.recall.state).toEqual({
    kind: "too_late",
    message: "Too late: that message already started",
  });
  expect(f.restore).not.toHaveBeenCalled();
});

it("keeps denial/transport errors distinct from accepted and TooLate, retrying the same target", async () => {
  const f = fixture();
  f.session.cancel.mockRejectedValueOnce(new Error("Not your message"));
  expect(await f.recall.recall()).toBe("uncertain");
  expect(f.recall.state).toEqual({
    kind: "uncertain",
    message: "Not your message",
  });
  f.session.latestPending.mockResolvedValue({ ...newest, commandId: "C" });
  expect(await f.recall.recall()).toBe("restored");
  expect(f.session.latestPending).toHaveBeenCalledTimes(1);
  expect(f.session.cancel.mock.calls).toEqual([
    [{ commandId: "B", onlyIfPending: true }],
    [{ commandId: "B", onlyIfPending: true }],
  ]);
});

it("unlocks on timeout, retains the target, and never applies a late accepted reply over newer typing", async () => {
  vi.useFakeTimers();
  const f = fixture();
  const cancellation = deferred<{ commandId: string; status: "accepted" }>();
  f.session.cancel.mockReturnValue(cancellation.promise);
  const first = f.recall.recall();
  await vi.advanceTimersByTimeAsync(5_001);
  expect(await first).toBe("uncertain");
  expect(f.recall.state.kind).toBe("uncertain");
  expect(await f.recall.recall()).toBe("uncertain");
  expect(f.session.cancel).toHaveBeenCalledTimes(1);
  f.setRevision(undefined);
  cancellation.resolve({ commandId: "B", status: "accepted" });
  await vi.advanceTimersByTimeAsync(0);
  expect(f.restore).not.toHaveBeenCalled();
  f.setRevision(2);
  expect(await f.recall.recall()).toBe("restored");
  expect(f.restore).toHaveBeenCalledExactlyOnceWith(newest, 2);
  expect(f.session.cancel).toHaveBeenCalledTimes(1);
});

it("never cancels after a timed-out lookup completes late", async () => {
  vi.useFakeTimers();
  const f = fixture();
  const lookup = deferred<SessionPendingPrompt | null>();
  f.session.latestPending.mockReturnValue(lookup.promise);
  const first = f.recall.recall();
  await vi.advanceTimersByTimeAsync(5_001);
  expect(await first).toBe("uncertain");
  lookup.resolve(newest);
  await Promise.resolve();
  expect(f.session.cancel).not.toHaveBeenCalled();
});

it("retains an accepted payload when a programmatic draft change prevented restoration", async () => {
  const f = fixture();
  const cancellation = deferred<{ commandId: string; status: "accepted" }>();
  f.session.cancel.mockReturnValue(cancellation.promise);
  const first = f.recall.recall();
  await Promise.resolve();
  f.setRevision(1);
  cancellation.resolve({ commandId: "B", status: "accepted" });
  expect(await first).toBe("uncertain");
  f.setRevision(2);
  expect(await f.recall.recall()).toBe("restored");
  expect(f.session.cancel).toHaveBeenCalledTimes(1);
});

it("releases a departing Session without restoring its payload into another composer", async () => {
  const f = fixture();
  const cancellation = deferred<{ commandId: string; status: "accepted" }>();
  f.session.cancel.mockReturnValue(cancellation.promise);
  const first = f.recall.recall();
  await Promise.resolve();
  f.recall.dispose();
  expect(await first).toBe("ignored");
  cancellation.resolve({ commandId: "B", status: "accepted" });
  await Promise.resolve();
  expect(f.restore).not.toHaveBeenCalled();
  expect(await f.recall.recall()).toBe("ignored");
});

it("retries a failed draft restore from the accepted payload without cancelling again", async () => {
  const f = fixture();
  f.restore.mockImplementationOnce(() => {
    throw new Error("Draft journal unavailable");
  });
  expect(await f.recall.recall()).toBe("uncertain");
  expect(f.recall.state).toEqual({
    kind: "uncertain",
    message: "Draft journal unavailable",
  });
  expect(await f.recall.recall()).toBe("restored");
  expect(f.session.cancel).toHaveBeenCalledTimes(1);
  expect(f.restore).toHaveBeenLastCalledWith(newest, 0);
});

it("keeps an unavailable owner lookup distinct from an empty queue and cancellation", async () => {
  const f = fixture();
  f.session.latestPending.mockRejectedValueOnce(
    new Error("Session unavailable"),
  );
  expect(await f.recall.recall()).toBe("uncertain");
  expect(f.recall.state).toEqual({
    kind: "uncertain",
    message: "Session unavailable",
  });
  expect(f.session.cancel).not.toHaveBeenCalled();
  expect(await f.recall.recall()).toBe("restored");
  expect(f.session.latestPending).toHaveBeenCalledTimes(2);
});

it("retains recovery in its original Session while a different Session has its own draft", async () => {
  vi.useFakeTimers();
  const original = fixture();
  const other = fixture();
  other.setRevision(undefined);
  const cancellation = deferred<{ commandId: string; status: "accepted" }>();
  original.session.cancel.mockReturnValue(cancellation.promise);
  const pending = original.recall.recall();
  await vi.advanceTimersByTimeAsync(5_001);
  expect(await pending).toBe("uncertain");
  cancellation.resolve({ commandId: "B", status: "accepted" });
  await vi.advanceTimersByTimeAsync(0);
  expect(await other.recall.recall()).toBe("ignored");
  expect(await original.recall.recall()).toBe("restored");
  expect(original.restore).toHaveBeenCalledExactlyOnceWith(newest, 0);
  expect(other.restore).not.toHaveBeenCalled();
  expect(other.session.latestPending).not.toHaveBeenCalled();
  expect(other.session.cancel).not.toHaveBeenCalled();
});
