// @vitest-environment jsdom
import { PassThrough } from "node:stream";
import type {
  CancelCommand,
  CancelResult,
  SessionPendingPrompt,
  SessionSnapshot,
} from "@fungi.computer/shiitake/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import {
  ParakeetProvider,
  useTimeline,
  useComposer,
  type ParakeetToast,
} from "../src/headless.js";
import { TimelineItem } from "../src/components/TimelineItem.js";
import type { ParakeetSession } from "../src/session.js";
import {
  commandHandler,
  commandResult,
  noExtension,
  sessionSnapshot,
} from "./fixtures/session.fixture.js";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
  writable: true,
});

const roots = new Set<Root>();
afterEach(async () => {
  await act(async () => {
    for (const root of roots) root.unmount();
    await Promise.resolve();
  });
  roots.clear();
  document.body.replaceChildren();
  localStorage.clear();
});

const prompts: readonly SessionPendingPrompt[] = [
  {
    commandId: "queued-A",
    requestId: "request-A",
    text: "Cancel A",
    delivery: "followUp",
  },
  {
    commandId: "queued-B",
    requestId: "request-B",
    text: "Keep B",
    delivery: "followUp",
  },
];

function fixture() {
  const frames = new PassThrough({ objectMode: true });
  let resolve: ((value: CancelResult) => void) | undefined;
  let reject: ((reason: Error) => void) | undefined;
  const reply = new Promise<CancelResult>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  const cancel = vi.fn<(input: CancelCommand) => Promise<CancelResult>>(
    () => reply,
  );
  const baseline = sessionSnapshot({
    status: "streaming",
    pending: { total: 2, prompts, hasMore: false },
    progress: {
      messageId: "active",
      revision: 1,
      text: "Current turn stays active",
      thinking: "",
      textTruncated: false,
      thinkingTruncated: false,
      textOffset: 0,
      thinkingOffset: 0,
    },
  });
  const session: ParakeetSession = {
    address: "test://queued-cancel",
    latestPending: () => Promise.resolve(prompts[0] ?? null),
    withdraw: () =>
      Promise.reject(
        new Error("Admission withdrawal is not queued cancellation"),
      ),
    extension: noExtension,
    command: commandHandler(commandResult, undefined, cancel),
    read: () => Promise.resolve(baseline),
    watch: () =>
      Promise.resolve({
        snapshot: baseline,
        changes: frames,
        close: () => {
          frames.end();
          return Promise.resolve();
        },
      }),
  };
  return {
    session,
    cancel,
    baseline,
    accept: (value: CancelResult) => {
      if (resolve === undefined) throw new Error("Reply is unavailable");
      resolve(value);
    },
    fail: () => {
      if (reject === undefined) throw new Error("Reply is unavailable");
      reject(new Error("Connection lost"));
    },
    publish: (pending = prompts) => {
      frames.write({
        kind: "reset",
        reason: "history_unavailable",
        cursor: null,
        baseline: {
          ...baseline,
          pending: { total: pending.length, prompts: pending, hasMore: false },
        },
      });
    },
    publishSnapshot: (baseline: SessionSnapshot) => {
      frames.write({
        kind: "reset",
        reason: "history_unavailable",
        cursor: baseline.cursor,
        baseline,
      });
    },
  };
}

/** Same shared row renderer and controller as the virtualized browser timeline. */
function Rows() {
  const timeline = useTimeline();
  const composer = useComposer();
  return (
    <>
      <textarea
        aria-label="Draft"
        value={composer.draft}
        onChange={(event) => {
          composer.setDraft(event.target.value);
        }}
      />
      {[...timeline.settled, ...timeline.tail].map((item) => (
        <div key={item.id} data-parakeet-id={item.id}>
          <TimelineItem
            item={item}
            cancellingQueued={timeline.cancellingQueued}
            onCancelQueued={(id) => {
              void timeline.cancelQueued(id);
            }}
          />
        </div>
      ))}
    </>
  );
}

function render(session: ParakeetSession) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.add(root);
  const client = new QueryClient();
  const toasts: ParakeetToast[] = [];
  const onToast = (toast: ParakeetToast) => {
    toasts.push(toast);
  };
  const show = (selected: ParakeetSession) => {
    act(() => {
      root.render(
        <QueryClientProvider client={client}>
          <ParakeetProvider session={selected} onToast={onToast}>
            <Rows />
          </ParakeetProvider>
        </QueryClientProvider>,
      );
    });
  };
  show(session);
  return { container, show, toasts };
}

const row = (container: HTMLElement, id: string) =>
  container.querySelector(`[data-parakeet-id="${id}"]`);

async function settle(operation?: () => void) {
  await act(async () => {
    operation?.();
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  });
}

function clickCancel(container: HTMLElement) {
  const button = row(container, "queued-A")?.querySelector<HTMLButtonElement>(
    'button[aria-label="Cancel queued message"]',
  );
  if (!button) throw new Error("Queued Cancel action is unavailable");
  button.click();
}

async function ready(container: HTMLElement) {
  await vi.waitFor(async () => {
    await settle();
    expect(row(container, "queued-A")).not.toBeNull();
  });
}

it("removes only queued A before cancellation resolves and coalesces repeated clicks", async () => {
  const owner = fixture();
  const { container } = render(owner.session);
  await ready(container);
  const button = row(container, "queued-A")?.querySelector<HTMLButtonElement>(
    'button[aria-label="Cancel queued message"]',
  );
  expect(button).not.toBeNull();
  if (!button) throw new Error("Queued Cancel action is unavailable");
  const input = container.querySelector("textarea");
  if (!input) throw new Error("Draft is unavailable");
  await settle(() => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set?.call(input, "A newer draft");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    button.click();
    button.click();
    await Promise.resolve();
  });
  // The owner reply is still unresolved here.
  expect(row(container, "queued-A")).toBeNull();
  expect(input.value).toBe("A newer draft");
  expect(row(container, "queued-B")?.textContent).toContain("Keep B");
  expect(row(container, "active")?.textContent).toContain(
    "Current turn stays active",
  );
  expect(owner.cancel).toHaveBeenCalledExactlyOnceWith({
    type: "cancel",
    commandId: "queued-A",
    onlyIfPending: true,
  });
  await settle(() => {
    owner.publish();
  });
  expect(row(container, "queued-A")).toBeNull();
  await settle(() => {
    owner.accept({ status: "accepted", commandId: "queued-A" });
  });
  // An old queued snapshot is not acceptance reversal.
  await settle(() => {
    owner.publish();
  });
  expect(row(container, "queued-A")).toBeNull();
  await settle(() => {
    owner.publish(prompts.slice(1));
  });
  expect(row(container, "queued-B")).not.toBeNull();
  expect(input.value).toBe("A newer draft");
});

it.each(["too_late", "uncertain"])(
  "reconciles %s visibly without claiming removal",
  async (outcome) => {
    const owner = fixture();
    const { container, toasts } = render(owner.session);
    await ready(container);
    await settle(() => {
      clickCancel(container);
    });
    expect(row(container, "queued-A")).toBeNull();
    await settle(() => {
      if (outcome === "uncertain") owner.fail();
      else owner.accept({ status: "too_late", commandId: "queued-A" });
    });
    expect(row(container, "queued-A")?.textContent).toContain("Cancel A");
    expect(row(container, "queued-B")?.textContent).toContain("Keep B");
    expect(toasts).toHaveLength(1);
    expect(toasts[0]?.variant).toBe("warning");
    expect(toasts[0]?.message).toContain(
      outcome === "uncertain" ? "unconfirmed" : "no longer pending",
    );
  },
);

it("never hides a turn that starts while its queued cancellation is unresolved", async () => {
  const owner = fixture();
  const { container } = render(owner.session);
  await ready(container);
  await settle(() => {
    clickCancel(container);
  });
  await settle(() => {
    owner.publishSnapshot(
      sessionSnapshot({
        ...owner.baseline,
        activity: {
          ...owner.baseline.activity,
          queue: { state: "running", commandId: "queued-A" },
        },
        pending: { total: 1, prompts: prompts.slice(1), hasMore: false },
        messages: [
          {
            id: "started-A",
            sequence: 1,
            commandId: "queued-A",
            value: { role: "user", content: "Cancel A", timestamp: 1 },
          },
        ],
        progress: {
          messageId: "running-A",
          revision: 1,
          text: "A is now running",
          thinking: "",
          textTruncated: false,
          thinkingTruncated: false,
          textOffset: 0,
          thinkingOffset: 0,
        },
      }),
    );
  });
  // Publishing a watch frame does not mean its projection has rendered.
  // Observe independent progress before checking the still-unresolved mask.
  await vi.waitFor(async () => {
    await settle();
    expect(row(container, "running-A")?.textContent).toContain(
      "A is now running",
    );
  });
  expect(row(container, "started-A")?.textContent).toContain("Cancel A");
  expect(row(container, "running-A")?.textContent).toContain(
    "A is now running",
  );
  expect(row(container, "started-A")?.querySelector("button")).toBeNull();
  await settle(() => {
    owner.accept({ status: "too_late", commandId: "queued-A" });
  });
  expect(row(container, "running-A")).not.toBeNull();
  expect(row(container, "queued-B")).not.toBeNull();
});

it("does not carry a hidden command or a late result into another conversation", async () => {
  const first = fixture();
  const second = fixture();
  const { container, show, toasts } = render(first.session);
  await ready(container);
  await settle(() => {
    clickCancel(container);
  });
  expect(row(container, "queued-A")).toBeNull();
  show({ ...second.session, address: "test://other-conversation" });
  await ready(container);
  expect(row(container, "queued-A")).not.toBeNull();
  await settle(() => {
    first.fail();
  });
  expect(row(container, "queued-A")).not.toBeNull();
  expect(second.cancel).not.toHaveBeenCalled();
  expect(toasts).toEqual([]);
});
