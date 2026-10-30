// @vitest-environment jsdom
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";

import type {
  Accepted,
  PromptCommand,
  SessionFrame,
  SessionMessage,
  SessionWatch,
} from "@fungi.computer/shiitake/client";
import {
  ParakeetProvider,
  useClientContributions,
  useClientActions,
  useSlashCommands,
  useComposer,
  useStatus,
  useTimeline,
} from "../src/headless.js";
import type {
  ParakeetReconnectOutcome,
  ParakeetDraftStorage,
  ParakeetToast,
  ComposerController,
} from "../src/headless.js";
import type { TimelineController } from "../src/conversation.js";
import { ClientRows } from "../src/components/ClientRows.js";
import { useState } from "react";
import { createWhistle } from "@fungi.computer/whistle";
import { z } from "zod";
import { draftJournal } from "../src/core/draft-storage.js";
import type { ParakeetSession } from "../src/session.js";
import type { TimelineItem } from "../src/store/types.js";
import {
  commandHandler,
  commandResult,
  committedGoal,
  extensionCalls,
  goalSlots,
  goalContract,
  probeClients,
  noExtension,
  sessionFrame,
  sessionSnapshot,
  type FixtureGoal,
  type FixtureStatus,
} from "./fixtures/session.fixture.js";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
  writable: true,
});

type FrameQueue = AsyncIterable<SessionFrame> & {
  push: (frame: SessionFrame) => void;
  fail: (error: Error) => void;
};

function frameQueue(): FrameQueue {
  const queued: SessionFrame[] = [];
  let failure: Error | undefined;
  const waiting: Readonly<{
    resolve: (result: IteratorResult<SessionFrame>) => void;
    reject: (error: Error) => void;
  }>[] = [];
  const iterator: AsyncIterator<SessionFrame> = {
    next: () => {
      if (failure !== undefined) {
        const error = failure;
        failure = undefined;
        return Promise.reject(error);
      }
      const frame = queued.shift();
      if (frame !== undefined)
        return Promise.resolve({ done: false, value: frame });
      return new Promise((resolve, reject) => {
        waiting.push({ resolve, reject });
      });
    },
    return: () => Promise.resolve({ done: true, value: undefined }),
  };
  return {
    [Symbol.asyncIterator]: () => iterator,
    push: (frame) => {
      const pending = waiting.shift();
      if (pending === undefined) queued.push(frame);
      else pending.resolve({ done: false, value: frame });
    },
    fail: (error) => {
      const pending = waiting.shift();
      if (pending === undefined) failure = error;
      else pending.reject(error);
    },
  };
}

function watch(
  changes: FrameQueue,
  snapshot = sessionSnapshot(),
): Promise<SessionWatch> {
  return Promise.resolve({
    snapshot,
    changes,
    close: () => Promise.resolve(),
  });
}

function ControllerProbe({
  onItems,
  onReconnect,
  onComposer,
}: {
  onItems?: ((items: readonly TimelineItem[]) => void) | undefined;
  onReconnect?: ((outcome: ParakeetReconnectOutcome) => void) | undefined;
  onComposer?: ((composer: ComposerController) => void) | undefined;
}): ReactElement {
  const timeline = useTimeline();
  const composer = useComposer();
  onComposer?.(composer);
  const status = useStatus();
  const contributions = useClientContributions();
  const [commands] = useState(createWhistle);
  useSlashCommands({
    commands,
    origin: "browser",
    keys: {},
    busy: status.status !== "idle",
  });
  const actions = useClientActions(commands);
  const items = [...timeline.settled, ...timeline.tail];
  onItems?.(items);
  return (
    <div
      data-status={status.status}
      data-view-state={status.viewState.kind}
      data-view-cause={
        status.viewState.kind === "disconnected"
          ? status.viewState.cause
          : undefined
      }
      data-failed={String(composer.failure !== undefined)}
      data-failure={composer.failure}
      data-admission-error={composer.admissionError}
      data-draft={composer.draft}
      data-observation={status.observation.status}
      data-goal-state={contributions[0]?.value.panel[0]?.detail ?? "none"}
    >
      {contributions.map(({ entryId, value }) => (
        <section key={entryId} aria-label="Session goal">
          <ClientRows entryId={entryId} rows={value.panel} actions={actions} />
        </section>
      ))}
      <input
        aria-label="Draft"
        onChange={(event) => {
          composer.setDraft(event.target.value);
        }}
        value={composer.draft}
      />
      <button
        onClick={() => {
          composer.send();
        }}
        type="button"
      >
        Send
      </button>
      <button onClick={composer.retry} type="button">
        Retry
      </button>
      <button onClick={() => void composer.cancel()} type="button">
        Abort
      </button>
      <button
        onClick={() => {
          void status.reconnect().then(onReconnect);
        }}
        type="button"
      >
        Reconnect
      </button>
      <button
        onClick={() => {
          composer.send("followUp");
        }}
        type="button"
      >
        Queue
      </button>
      {items.map((item) => {
        const failedAdmission =
          item.kind === "user_message" && item.status === "failed"
            ? item
            : undefined;
        const failedRequestId = failedAdmission?.requestId;
        return (
          <div
            data-id={item.id}
            data-kind={item.kind}
            data-state={item.kind === "user_message" ? item.status : undefined}
            key={item.id}
          >
            {item.kind === "user_message" ? item.text : null}
            {failedRequestId === undefined ? null : (
              <button
                onClick={() => {
                  composer.dismissFailed(failedRequestId);
                }}
                type="button"
              >
                Dismiss failed prompt
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

type SubscriptionCounts = {
  composer: number;
  settled: readonly unknown[] | undefined;
  status: number;
  timeline: number;
};

function TimelineSubscriptionProbe({
  counts,
}: Readonly<{ counts: SubscriptionCounts }>): ReactElement {
  const timeline = useTimeline();
  counts.timeline += 1;
  counts.settled = timeline.settled;
  return <output data-tail={timeline.tail.length} />;
}

function HistoryWindowProbe({
  observe,
}: Readonly<{
  observe: (timeline: TimelineController) => void;
}>): ReactElement {
  const timeline = useTimeline();
  observe(timeline);
  return <output data-oldest={timeline.settled[0]?.id} />;
}

function ComposerSubscriptionProbe({
  counts,
}: Readonly<{ counts: SubscriptionCounts }>): ReactElement {
  const composer = useComposer();
  counts.composer += 1;
  return (
    <input
      aria-label="Isolated draft"
      onChange={(event) => {
        composer.setDraft(event.target.value);
      }}
      value={composer.draft}
    />
  );
}

function StatusSubscriptionProbe({
  counts,
}: Readonly<{ counts: SubscriptionCounts }>): ReactElement {
  const status = useStatus();
  counts.status += 1;
  return <output data-session-status={status.status} />;
}

function SubscriptionProbe({
  counts,
}: Readonly<{ counts: SubscriptionCounts }>): ReactElement {
  return (
    <>
      <TimelineSubscriptionProbe counts={counts} />
      <ComposerSubscriptionProbe counts={counts} />
      <StatusSubscriptionProbe counts={counts} />
    </>
  );
}

it("projects a goal-only Session update independently of run status", async () => {
  const changes = frameQueue();
  const session: ParakeetSession = {
    latestPending: () => Promise.resolve(null),
    withdraw: () => Promise.resolve({ status: "unknown" }),
    address: "test://parakeet/goal-session",
    command: commandHandler(commandResult),
    extension: noExtension,
    read: () =>
      Promise.resolve(
        sessionSnapshot({
          cursor: "goal-cursor",
          extensions: goalSlots({
            revision: "goal-revision",
            objective: "Ship the footer",
            state: "active",
          }),
        }),
      ),
    watch: () =>
      watch(
        changes,
        sessionSnapshot({
          cursor: "goal-cursor",
          extensions: goalSlots({
            revision: "goal-revision",
            objective: "Ship the footer",
            state: "active",
          }),
        }),
      ),
  };
  const container = render(session);
  await settle();
  await settle();
  expect(container.firstElementChild?.getAttribute("data-goal-state")).toBe(
    "active",
  );

  await settle(() => {
    changes.push(
      sessionFrame({
        pending: { total: 0, prompts: [], hasMore: false },
        kind: "update",
        delivery: "live",
        cursor: "goal-cursor",
        messages: [],
        terminals: [],
        status: "idle",
        extensions: goalSlots({
          revision: "goal-revision",
          objective: "Ship the footer",
          state: "paused",
        }),
      }),
    );
  });
  await settle();
  expect(container.firstElementChild?.getAttribute("data-goal-state")).toBe(
    "paused",
  );
  expect(container.firstElementChild?.getAttribute("data-status")).toBe("idle");
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
  vi.useRealTimers();
});

it("recovers the exact submitted text after closing before acceptance and reopening", async () => {
  const changes = frameQueue();
  const session: ParakeetSession = {
    address: "test://durable-pending",
    command: commandHandler(() => new Promise<Accepted>(() => undefined)),
    latestPending: () => Promise.resolve(null),
    withdraw: () => Promise.resolve({ status: "unknown" }),
    extension: noExtension,
    read: () => Promise.resolve(sessionSnapshot()),
    watch: () => watch(changes),
  };
  const first = mount(session, new QueryClient());
  await settle();
  const input = first.container.querySelector("input");
  if (!input) throw new Error("Composer unavailable");
  const original = "  Preserve my exact text  ";
  await settle(() => {
    change(input, original);
  });
  const send = first.container.querySelector("button");
  if (!send) throw new Error("Send unavailable");
  await settle(() => {
    send.click();
  });
  expect(input.value).toBe("");
  expect(
    localStorage.getItem(`fungi.parakeet.drafts.v2:${session.address}`),
  ).toContain(original);
  await settle(() => {
    first.root.unmount();
  });
  roots.delete(first.root);
  const reopened = mount(session, new QueryClient());
  await vi.waitFor(() => {
    expect(
      reopened.container.firstElementChild?.getAttribute("data-draft"),
    ).toBe(original);
  });
});

for (const mode of ["timeout", "service loss", "disconnect", "refusal"]) {
  it(`recovers ${mode} during a running turn without losing newer typing`, async () => {
    vi.useFakeTimers();
    let connected = mode !== "service loss";
    let changes = frameQueue();
    let requestId: string | undefined;
    let refuse: ((cause: Error) => void) | undefined;
    const withdraw = vi.fn<ParakeetSession["withdraw"]>(() =>
      connected
        ? Promise.resolve({ status: "unknown" })
        : Promise.reject(new Error("Service stopped")),
    );
    const session: ParakeetSession = {
      address: `test://recovery/${mode}`,
      latestPending: () => Promise.resolve(null),
      withdraw,
      command: commandHandler((input) => {
        requestId = input.requestId;
        return new Promise<Accepted>((_resolve, reject) => {
          refuse = reject;
        });
      }),
      extension: noExtension,
      read: () => Promise.resolve(sessionSnapshot({ status: "thinking" })),
      watch: () => watch(changes, sessionSnapshot({ status: "thinking" })),
    };
    const query = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const toasts: string[] = [];
    const view = mount(session, query, undefined, undefined, {
      onToast: (toast) => {
        toasts.push(toast.message);
      },
    });
    const tick = () =>
      act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
    await tick();
    const input = view.container.querySelector("input");
    const send = view.container.querySelector("button");
    if (!input || !send) throw new Error("Composer unavailable");
    const original = "  Exact text including whitespace  ";
    act(() => {
      change(input, original);
    });
    act(() => {
      send.click();
    });
    expect(input.value).toBe("");
    act(() => {
      change(input, "New typing");
    });
    if (mode === "refusal") {
      refuse?.(new Error("No credit"));
      await tick();
    } else if (mode === "disconnect") {
      act(() => {
        changes.fail(new Error("Disconnected"));
      });
      await tick();
      changes = frameQueue();
      const reconnect = [...view.container.querySelectorAll("button")].find(
        (button) => button.textContent === "Reconnect",
      );
      act(() => reconnect?.click());
      await tick();
    } else {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      if (mode === "service loss") {
        expect(input.value).toBe("New typing");
        expect(
          localStorage.getItem(`fungi.parakeet.drafts.v2:${session.address}`),
        ).toContain("Exact text");
        connected = true;
        act(() => {
          changes.fail(new Error("Service stopped"));
        });
        await tick();
        changes = frameQueue();
        const reconnect = [...view.container.querySelectorAll("button")].find(
          (button) => button.textContent === "Reconnect",
        );
        act(() => reconnect?.click());
        await tick();
      }
    }
    expect(withdraw).toHaveBeenCalledWith(requestId);
    expect(view.container.firstElementChild?.getAttribute("data-draft")).toBe(
      `New typing\n\n${original}`,
    );
    expect(toasts.some((message) => message.startsWith("Not sent: "))).toBe(
      true,
    );
    expect(
      view.container.querySelectorAll('[data-state="pending"]'),
    ).toHaveLength(0);
  });
}

it.each(["unknown", "accepted", "unavailable"] as const)(
  "settles held admission after watch loss without reconnect or elapsed time (%s)",
  async (outcome) => {
    vi.useFakeTimers();
    const startedAt = Date.now();
    const changes = frameQueue();
    const commands: PromptCommand[] = [];
    const reply = new Promise<Accepted>(() => undefined);
    const withdraw = vi.fn<ParakeetSession["withdraw"]>(() => {
      if (outcome === "unavailable")
        return Promise.reject(new Error("Withdrawal is unavailable"));
      return Promise.resolve(
        outcome === "accepted"
          ? { status: "accepted", commandId: "recorded-owner-entry" }
          : { status: "unknown" },
      );
    });
    const open = vi.fn(() => watch(changes));
    const session: ParakeetSession = {
      address: `test://watch-loss-held-ack/${outcome}`,
      latestPending: () => Promise.resolve(null),
      withdraw,
      command: commandHandler((input) => {
        commands.push(input);
        return reply;
      }),
      extension: noExtension,
      read: () => Promise.resolve(sessionSnapshot()),
      watch: open,
    };
    let current: ComposerController | undefined;
    const composer = () => {
      if (current === undefined) throw new Error("Missing composer");
      return current;
    };
    const view = mount(
      session,
      new QueryClient({ defaultOptions: { queries: { retry: false } } }),
      undefined,
      undefined,
      {
        onComposer: (value) => {
          current = value;
        },
      },
    );
    const tick = () =>
      act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
    await tick();
    const input = view.container.querySelector("input");
    const send = view.container.querySelector("button");
    if (!input || !send) throw new Error("Composer unavailable");
    const original = "  Exact held text\nwith whitespace  ";
    act(() => {
      composer().setDraft(original);
    });
    act(() => {
      send.click();
    });
    act(() => {
      change(input, "Newer draft");
    });
    await tick();
    const submitted = commands[0];
    if (submitted === undefined) throw new Error("Missing held command");
    expect(submitted.text).toBe(original);
    expect(withdraw).not.toHaveBeenCalled();
    act(() => {
      changes.fail(new Error("Watch failed while reply is held"));
    });
    await tick();
    await tick();
    expect(
      view.container.firstElementChild?.getAttribute("data-observation"),
    ).toBe("unavailable");
    expect(withdraw).toHaveBeenCalledExactlyOnceWith(submitted.requestId);
    expect(open).toHaveBeenCalledTimes(1);
    expect(Date.now()).toBe(startedAt);
    const journal = draftJournal(session.address, localStorage).read();
    if (outcome === "unknown") {
      expect(composer().draft).toBe(`Newer draft\n\n${original}`);
      expect(journal.draft).toBe(composer().draft);
      expect(journal.pending).toEqual([]);
      expect(
        view.container.querySelector('[data-state="failed"]'),
      ).not.toBeNull();
    } else {
      expect(input.value).toBe("Newer draft");
      expect(view.container.querySelector('[data-state="failed"]')).toBeNull();
      if (outcome === "unavailable") {
        expect(journal.pending).toHaveLength(1);
        expect(journal.pending[0]).toMatchObject({
          requestId: submitted.requestId,
          content: original,
        });
      } else {
        expect(journal.pending).toEqual([]);
        expect(
          view.container.querySelectorAll('[data-state="accepted"]'),
        ).toHaveLength(1);
      }
    }
    expect(commands).toHaveLength(1);
  },
);

it("keeps an admitted send on reopen and preserves the newer durable draft", async () => {
  let requestId: string | undefined;
  const withdraw = vi.fn<ParakeetSession["withdraw"]>(() =>
    Promise.resolve({ status: "accepted", commandId: "already-sent" }),
  );
  const session: ParakeetSession = {
    address: "test://reopen-accepted",
    latestPending: () => Promise.resolve(null),
    withdraw,
    command: commandHandler((input) => {
      requestId = input.requestId;
      return new Promise<Accepted>(() => undefined);
    }),
    extension: noExtension,
    read: () => Promise.resolve(sessionSnapshot()),
    watch: () => watch(frameQueue()),
  };
  const first = mount(session, new QueryClient());
  await settle();
  const input = first.container.querySelector("input");
  const send = first.container.querySelector("button");
  if (!input || !send) throw new Error("Composer unavailable");
  await settle(() => {
    change(input, "Sent before close");
  });
  await settle(() => {
    send.click();
  });
  await settle(() => {
    change(input, "Newer draft");
  });
  await settle(() => {
    first.root.unmount();
  });
  roots.delete(first.root);
  const reopened = mount(session, new QueryClient());
  await vi.waitFor(() => {
    expect(withdraw).toHaveBeenCalledWith(requestId);
  });
  expect(reopened.container.querySelector("input")?.value).toBe("Newer draft");
  expect(
    reopened.container.querySelectorAll('[data-state="accepted"]'),
  ).toHaveLength(1);
  expect(
    JSON.parse(
      localStorage.getItem(`fungi.parakeet.drafts.v2:${session.address}`) ??
        "null",
    ),
  ).toEqual({ draft: "Newer draft", pending: [] });
});

it("never clears or dispatches when the pending text cannot be committed", async () => {
  const dispatch = vi.fn<() => Promise<Accepted>>(() =>
    Promise.resolve({ status: "accepted", commandId: "unexpected" }),
  );
  const session: ParakeetSession = {
    address: "test://quota",
    latestPending: () => Promise.resolve(null),
    withdraw: () => Promise.resolve({ status: "unknown" }),
    command: commandHandler(dispatch),
    extension: noExtension,
    read: () => Promise.resolve(sessionSnapshot()),
    watch: () => watch(frameQueue()),
  };
  const storage: ParakeetDraftStorage = {
    getItem: () => null,
    removeItem(key) {
      localStorage.removeItem(key);
    },
    setItem: (_key, value) => {
      if (value.includes('"requestId"'))
        throw new DOMException("Storage quota exceeded", "QuotaExceededError");
    },
  };
  const { container } = mount(
    session,
    new QueryClient(),
    undefined,
    undefined,
    { draftStorage: storage },
  );
  await settle();
  const input = container.querySelector("input");
  const send = container.querySelector("button");
  if (!input || !send) throw new Error("Composer unavailable");
  await settle(() => {
    change(input, "  Never discard this  ");
  });
  await settle(() => {
    send.click();
  });
  expect(input.value).toBe("  Never discard this  ");
  expect(dispatch).not.toHaveBeenCalled();
});

it("uses request identity to deduplicate watch-first acceptance and keeps newer drafts", async () => {
  const changes = frameQueue();
  let observedItems: readonly TimelineItem[] = [];
  let prompt: PromptCommand | undefined;
  let accept: ((result: Accepted) => void) | undefined;
  const session: ParakeetSession = {
    address: "test://watch-first",
    latestPending: () => Promise.resolve(null),
    withdraw: () => Promise.resolve({ status: "unknown" }),
    command: commandHandler((input) => {
      prompt = input;
      return new Promise<Accepted>((resolve) => {
        accept = resolve;
      });
    }),
    extension: noExtension,
    read: () => Promise.resolve(sessionSnapshot()),
    watch: () => watch(changes),
  };
  const { container } = mount(session, new QueryClient(), (items) => {
    observedItems = items;
  });
  await settle();
  const input = container.querySelector("input");
  const send = container.querySelector("button");
  if (!input || !send) throw new Error("Composer unavailable");
  await settle(() => {
    change(input, "First prompt");
  });
  await settle(() => {
    send.click();
  });
  await settle(() => {
    change(input, "New typing");
  });
  if (!prompt) throw new Error("Prompt was not dispatched");
  const submitted = prompt;
  await settle(() => {
    changes.push(
      sessionFrame({
        kind: "update",
        delivery: "live",
        cursor: "watch-first",
        status: "queued",
        messages: [],
        terminals: [],
        pending: {
          total: 1,
          hasMore: false,
          prompts: [
            {
              commandId: "owner-first",
              requestId: submitted.requestId,
              text: submitted.text,
              delivery: submitted.delivery,
            },
          ],
        },
      }),
    );
  });
  // One row also describes the optimistic admission; wait for owner identity.
  await vi.waitFor(async () => {
    await act(async () => Promise.resolve());
    expect(observedItems).toContainEqual(
      expect.objectContaining({
        id: "owner-first",
        kind: "user_message",
        requestId: submitted.requestId,
        status: "queued",
      }),
    );
  });
  expect(container.querySelectorAll('[data-kind="user_message"]')).toHaveLength(
    1,
  );
  expect(container.querySelectorAll('[data-state="pending"]')).toHaveLength(0);
  expect(draftJournal(session.address, localStorage).read().pending).toEqual(
    [],
  );
  expect(input.value).toBe("New typing");
  await settle(() =>
    accept?.({ status: "accepted", commandId: "owner-first" }),
  );
  expect(container.querySelectorAll('[data-kind="user_message"]')).toHaveLength(
    1,
  );
  expect(input.value).toBe("New typing");
});

function mount(
  session: ParakeetSession,
  queryClient: QueryClient,
  onItems?: (items: readonly TimelineItem[]) => void,
  onReconnect?: (outcome: ParakeetReconnectOutcome) => void,
  options?: Readonly<{
    draftStorage?: ParakeetDraftStorage;
    onToast?: (toast: ParakeetToast) => void;
    onComposer?: (composer: ComposerController) => void;
  }>,
) {
  const { onComposer, ...providerOptions } = options ?? {};
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.add(root);
  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <ParakeetProvider
          session={session}
          clients={probeClients}
          {...providerOptions}
        >
          <ControllerProbe
            onItems={onItems}
            onReconnect={onReconnect}
            onComposer={onComposer}
          />
        </ParakeetProvider>
      </QueryClientProvider>,
    );
  });
  return { container, root };
}

function render(session: ParakeetSession): HTMLDivElement {
  return mount(session, new QueryClient()).container;
}

function durableMessages(count: number): readonly SessionMessage[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `message-${String(index)}`,
    commandId: `command-${String(index)}`,
    sequence: index + 1,
    value: {
      role: "user" as const,
      content: `Message ${String(index)}`,
      timestamp: index + 1,
    },
  }));
}

it("evicts browsed pages and refetches them in both directions", async () => {
  const messages = durableMessages(700);
  const changes = frameQueue();
  const reads: string[] = [];
  const page = (end: number, limit: number) => {
    const start = Math.max(0, end - limit);
    return sessionSnapshot({
      cursor: end === 0 ? null : `seq-${String(end)}`,
      hasMore: start > 0,
      oldestCursor: start > 0 ? `seq-${String(start + 1)}` : null,
      messages: messages.slice(start, end),
      pending: {
        total: 7,
        prompts: [
          {
            requestId: "request-" + "queued-one",
            commandId: "queued-one",
            text: "Next waiting task",
            delivery: "followUp",
          },
        ],
        hasMore: true,
      },
    });
  };
  const session: ParakeetSession = {
    latestPending: () => Promise.resolve(null),
    withdraw: () => Promise.resolve({ status: "unknown" }),
    address: "test://parakeet/windowed-history",
    command: commandHandler(commandResult),
    extension: noExtension,
    read: ({ before, limit = 100 } = {}) => {
      reads.push(before ?? "latest");
      const end =
        before === undefined ? messages.length : Number(before.slice(4)) - 1;
      return Promise.resolve(page(end, limit));
    },
    watch: () => watch(changes, page(messages.length, 100)),
  };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.add(root);
  let timeline: TimelineController | undefined;
  act(() => {
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <ParakeetProvider session={session} clients={probeClients}>
          <HistoryWindowProbe observe={(value) => (timeline = value)} />
        </ParakeetProvider>
      </QueryClientProvider>,
    );
  });
  await settle();
  await settle();
  expect(timeline?.settled.length).toBe(100);
  for (let index = 0; index < 6; index++) {
    await settle(() => timeline?.loadOlderHistory());
    await vi.waitFor(async () => {
      await settle();
      expect(timeline?.settled[0]?.id).toBe(
        `message-${String(500 - index * 100)}`,
      );
      expect(timeline?.loadingOlderHistory).toBe(false);
    });
    expect(timeline?.settled.length).toBeLessThanOrEqual(500);
  }
  expect(timeline?.settled[0]?.id).toBe("message-0");
  expect(timeline?.settled.at(-1)?.id).toBe("message-399");
  expect(timeline?.hasNewerHistory).toBe(true);
  expect(timeline?.tail).toEqual([]);
  expect(timeline?.queued.total).toBe(7);
  expect(timeline?.queued.prompts[0]?.text).toBe("Next waiting task");
  await settle(() => timeline?.loadNewerHistory());
  await vi.waitFor(async () => {
    await settle();
    expect(timeline?.settled[0]?.id).toBe("message-100");
    expect(timeline?.settled.at(-1)?.id).toBe("message-499");
    expect(timeline?.loadingOlderHistory).toBe(false);
  });
  await settle(() => timeline?.loadNewerHistory());
  await vi.waitFor(async () => {
    await settle();
    expect(timeline?.settled.at(-1)?.id).toBe("message-699");
    expect(timeline?.loadingOlderHistory).toBe(false);
  });
  expect(timeline?.hasNewerHistory).toBe(false);
  await settle(() => timeline?.jumpToLatest());
  expect(timeline?.settled[0]?.id).toBe("message-600");
  expect(timeline?.settled.length).toBe(100);
  expect(reads).toHaveLength(8);
});

function mountHistory(session: ParakeetSession, client: QueryClient) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.add(root);
  let current: TimelineController | undefined;
  act(() => {
    root.render(
      <QueryClientProvider client={client}>
        <ParakeetProvider session={session} clients={probeClients}>
          <HistoryWindowProbe
            observe={(value) => {
              current = value;
            }}
          />
        </ParakeetProvider>
      </QueryClientProvider>,
    );
  });
  return {
    root,
    get timeline() {
      if (current === undefined)
        throw new Error("History probe has not rendered");
      return current;
    },
  };
}

it("shares one history read across providers and retains the page after remount", async () => {
  const messages = durableMessages(200);
  const read = vi.fn(() =>
    Promise.resolve(
      sessionSnapshot({
        messages: messages.slice(0, 100),
        oldestCursor: null,
      }),
    ),
  );
  const session: ParakeetSession = {
    latestPending: () => Promise.resolve(null),
    withdraw: () => Promise.resolve({ status: "unknown" }),
    address: "test://parakeet/shared-history",
    command: commandHandler(commandResult),
    extension: noExtension,
    read,
    watch: () =>
      watch(
        frameQueue(),
        sessionSnapshot({
          messages: messages.slice(100),
          oldestCursor: "seq-101",
          hasMore: true,
        }),
      ),
  };
  const client = new QueryClient();
  const first = mountHistory(session, client);
  const second = mountHistory({ ...session }, client);
  await vi.waitFor(async () => {
    await act(async () => {
      await Promise.resolve();
    });
    expect(first.timeline.hasMoreHistory).toBe(true);
    expect(second.timeline.hasMoreHistory).toBe(true);
  });
  await settle(() => {
    first.timeline.loadOlderHistory();
    second.timeline.loadOlderHistory();
  });
  expect(read).toHaveBeenCalledExactlyOnceWith({
    before: "seq-101",
    limit: 100,
  });
  await vi.waitFor(async () => {
    await act(async () => {
      await Promise.resolve();
    });
    expect(first.timeline.loadingOlderHistory).toBe(false);
    expect(second.timeline.loadingOlderHistory).toBe(false);
    expect(first.timeline.settled).toHaveLength(200);
    expect(second.timeline.settled).toEqual(first.timeline.settled);
  });
  await settle(() => {
    first.root.unmount();
    roots.delete(first.root);
    second.root.unmount();
    roots.delete(second.root);
  });
  const remounted = mountHistory(session, client);
  await vi.waitFor(async () => {
    await act(async () => {
      await Promise.resolve();
    });
    expect(remounted.timeline.settled).toHaveLength(200);
    expect(remounted.timeline.hasMoreHistory).toBe(false);
    expect(remounted.timeline.loadingOlderHistory).toBe(false);
  });
  expect(read).toHaveBeenCalledTimes(1);
  await settle(() => {
    remounted.root.unmount();
    roots.delete(remounted.root);
  });
  client.clear();
});

it("jumping to latest discards an in-flight older page without restoring it later", async () => {
  let finish: (() => void) | undefined;
  const messages = durableMessages(200);
  const session: ParakeetSession = {
    latestPending: () => Promise.resolve(null),
    withdraw: () => Promise.resolve({ status: "unknown" }),
    address: "test://parakeet/history-jump",
    command: commandHandler(commandResult),
    extension: noExtension,
    read: () =>
      new Promise((resolve) => {
        finish = () => {
          resolve(sessionSnapshot({ messages: messages.slice(0, 100) }));
        };
      }),
    watch: () =>
      watch(
        frameQueue(),
        sessionSnapshot({
          messages: messages.slice(100),
          oldestCursor: "seq-101",
          hasMore: true,
        }),
      ),
  };
  const client = new QueryClient();
  const probe = mountHistory(session, client);
  await settle();
  await settle();
  await settle(() => {
    probe.timeline.loadOlderHistory();
  });
  expect(probe.timeline.loadingOlderHistory).toBe(true);
  await settle(() => {
    probe.timeline.jumpToLatest();
  });
  expect(probe.timeline.loadingOlderHistory).toBe(false);
  await settle(() => {
    if (finish === undefined) throw new Error("History read did not start");
    finish();
  });
  expect(probe.timeline.settled).toHaveLength(100);
  expect(probe.timeline.settled[0]?.id).toBe("message-100");
  await settle(() => {
    probe.root.unmount();
    roots.delete(probe.root);
  });
  client.clear();
});

it("reports a failed history read and retries the same cursor without losing the live page", async () => {
  const failure = vi
    .spyOn(console, "error")
    .mockImplementation(() => undefined);
  const read = vi
    .fn<ParakeetSession["read"]>()
    .mockRejectedValueOnce(new Error("History unavailable"))
    .mockResolvedValue(sessionSnapshot({ messages: durableMessages(1) }));
  const session: ParakeetSession = {
    latestPending: () => Promise.resolve(null),
    withdraw: () => Promise.resolve({ status: "unknown" }),
    address: "test://parakeet/history-retry",
    command: commandHandler(commandResult),
    extension: noExtension,
    read,
    watch: () =>
      watch(
        frameQueue(),
        sessionSnapshot({
          messages: durableMessages(2).slice(1),
          oldestCursor: "seq-2",
          hasMore: true,
        }),
      ),
  };
  const client = new QueryClient();
  const probe = mountHistory(session, client);
  await settle();
  await settle();
  await settle(() => {
    probe.timeline.loadOlderHistory();
  });
  await vi.waitFor(async () => {
    await settle();
    expect(probe.timeline.settled).toHaveLength(1);
    expect(probe.timeline.loadingOlderHistory).toBe(false);
  });
  expect(failure).toHaveBeenCalledWith(
    expect.stringContaining('"operation":"read older Session history"'),
    expect.anything(),
  );
  await settle(() => {
    probe.timeline.loadOlderHistory();
  });
  expect(read.mock.calls).toEqual([
    [{ before: "seq-2", limit: 100 }],
    [{ before: "seq-2", limit: 100 }],
  ]);
  await vi.waitFor(async () => {
    await settle();
    expect(probe.timeline.settled).toHaveLength(2);
  });
  await settle(() => {
    probe.root.unmount();
    roots.delete(probe.root);
  });
  client.clear();
  failure.mockRestore();
});

it("observes an owner that admits at most 200 messages per baseline", async () => {
  const changes = frameQueue();
  const session: ParakeetSession = {
    latestPending: () => Promise.resolve(null),
    withdraw: () => Promise.resolve({ status: "unknown" }),
    address: "test://parakeet/owner-page-limit",
    command: commandHandler(commandResult),
    extension: noExtension,
    read: () => Promise.resolve(sessionSnapshot()),
    watch: (options) => {
      if (options?.limit !== undefined && options.limit > 200)
        return Promise.reject(new Error("Owner baseline limit exceeded"));
      return watch(changes, sessionSnapshot({ messages: durableMessages(1) }));
    },
  };
  const items: TimelineItem[] = [];
  mount(
    session,
    new QueryClient({ defaultOptions: { queries: { retry: false } } }),
    (next) => {
      items.splice(0, items.length, ...next);
    },
  );
  await vi.waitFor(async () => {
    await settle();
    expect(items).toHaveLength(1);
  });
});

it("keeps the latest retry prompt when a long run evicts its message", async () => {
  const changes = frameQueue();
  const prompt = durableMessages(1)[0];
  if (prompt === undefined) throw new Error("Missing fixture prompt");
  const results: SessionMessage[] = Array.from({ length: 450 }, (_, index) => ({
    id: `result-${String(index)}`,
    data: {},
    commandId: null,
    sequence: index + 2,
    value: {
      role: "toolResult",
      toolCallId: `call-${String(index)}`,
      toolName: "execute",
      content: [{ type: "text", text: "done" }],
      isError: false,
      timestamp: index + 2,
    },
  }));
  const client = new QueryClient();
  let reads = 0;
  const session: ParakeetSession = {
    latestPending: () => Promise.resolve(null),
    withdraw: () => Promise.resolve({ status: "unknown" }),
    address: "test://parakeet/long-retry",
    command: commandHandler(commandResult),
    extension: noExtension,
    read: () => {
      reads += 1;
      return Promise.resolve(
        sessionSnapshot({
          cursor: "seq-451",
          hasMore: true,
          oldestCursor: "seq-252",
          messages: results.slice(-200),
        }),
      );
    },
    watch: () => watch(changes, sessionSnapshot({ messages: [prompt] })),
  };
  mount(session, client);
  await settle();
  for (let batch = 0; batch < 5; batch++) {
    await settle(() => {
      changes.push(
        sessionFrame({
          kind: "update",
          delivery: "live",
          cursor: `seq-${String((batch + 1) * 100)}`,
          messages: results.slice(batch * 100, (batch + 1) * 100),
          terminals: [],
          pending: { total: 0, prompts: [], hasMore: false },
          status: "idle",
        }),
      );
    });
  }
  const projection = client.getQueryData<{
    snapshot?: { messages: readonly SessionMessage[] };
    latestPrompt:
      | Readonly<{
          commandId: string;
          text: string;
          images: PromptCommand["images"];
        }>
      | undefined;
  }>(["shiitake-session", session.address]);
  expect(reads).toBeGreaterThan(0);
  expect(projection?.snapshot?.messages.length).toBeLessThanOrEqual(400);
  expect(projection?.latestPrompt).toEqual({
    commandId: "command-0",
    text: "Message 0",
    images: undefined,
  });
});

it("keeps the reader's page while the live tail refreshes", async () => {
  const messages = durableMessages(450);
  const changes = frameQueue();
  let reads = 0;
  const session: ParakeetSession = {
    latestPending: () => Promise.resolve(null),
    withdraw: () => Promise.resolve({ status: "unknown" }),
    address: "test://parakeet/pinned-reader",
    command: commandHandler(commandResult),
    extension: noExtension,
    read: () => {
      reads += 1;
      return Promise.resolve(
        sessionSnapshot({
          cursor: "seq-450",
          hasMore: true,
          oldestCursor: "seq-251",
          messages: messages.slice(-200),
        }),
      );
    },
    watch: () =>
      watch(changes, sessionSnapshot({ messages: messages.slice(0, 100) })),
  };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.add(root);
  let timeline: TimelineController | undefined;
  act(() => {
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <ParakeetProvider session={session} clients={probeClients}>
          <HistoryWindowProbe observe={(value) => (timeline = value)} />
        </ParakeetProvider>
      </QueryClientProvider>,
    );
  });
  for (
    let attempt = 0;
    attempt < 20 && timeline?.settled[0]?.id !== "message-0";
    attempt++
  )
    await settle();
  expect(timeline?.settled[0]?.id).toBe("message-0");
  await settle(() => timeline?.pinVisibleHistory());
  for (let index = 1; index < 5; index++) {
    await settle(() => {
      changes.push(
        sessionFrame({
          kind: "update",
          delivery: "live",
          cursor: `seq-${String(Math.min(index * 100 + 100, 450))}`,
          messages: messages.slice(
            index * 100,
            Math.min(index * 100 + 100, 450),
          ),
          terminals: [],
          pending: { total: 0, prompts: [], hasMore: false },
          status: "idle",
        }),
      );
    });
  }
  await settle();
  expect(reads).toBe(1);
  expect(timeline?.settled[0]?.id).toBe("message-0");
  expect(timeline?.settled.at(-1)?.id).toBe("message-449");
  await settle(() => timeline?.jumpToLatest());
  expect(timeline?.settled[0]?.id).toBe("message-250");
  expect(timeline?.settled.length).toBe(200);
});

function change(input: HTMLInputElement, value: string): void {
  const setValue = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set?.bind(input);
  if (setValue === undefined) throw new Error("Input setter is unavailable");
  setValue(value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function settle(operation?: () => void): Promise<void> {
  await act(async () => {
    operation?.();
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  });
}

it("shares one Session watch until the final mount leaves", async () => {
  const changes = frameQueue();
  let watchCount = 0;
  let closeCount = 0;
  const session: ParakeetSession = {
    latestPending: () => Promise.resolve(null),
    withdraw: () => Promise.resolve({ status: "unknown" }),
    address: "test://parakeet/shared-session",
    command: commandHandler(commandResult),
    extension: noExtension,
    read: () => Promise.resolve(sessionSnapshot()),
    watch: () => {
      watchCount += 1;
      return Promise.resolve({
        snapshot: sessionSnapshot(),
        changes,
        close: () => {
          closeCount += 1;
          return Promise.resolve();
        },
      });
    },
  };
  const queryClient = new QueryClient();
  const first = mount(session, queryClient);
  const second = mount(session, queryClient);

  await settle();
  expect(watchCount).toBe(1);

  await settle(() => {
    first.root.unmount();
    roots.delete(first.root);
  });
  expect(closeCount).toBe(0);

  await settle(() => {
    second.root.unmount();
    roots.delete(second.root);
  });
  expect(closeCount).toBe(1);
});

it("retains observed history and reopens a failed Session watch", async () => {
  const outcomes: ParakeetReconnectOutcome[] = [];
  const firstChanges = frameQueue();
  const secondChanges = frameQueue();
  const queues = [firstChanges, secondChanges];
  let watchCount = 0;
  let closeCount = 0;
  const initialBaseline = sessionSnapshot({
    cursor: "before-failure",
    status: "thinking",
    messages: [
      {
        id: "message-1",
        commandId: "command-1",
        sequence: 1,
        value: { role: "user", content: "Keep this", timestamp: 1 },
      },
    ],
  });
  const reconnectedBaseline = sessionSnapshot({
    cursor: "after-reconnect",
    status: "idle",
    messages: [
      ...initialBaseline.messages,
      {
        id: "message-2",
        commandId: "command-2",
        sequence: 2,
        value: { role: "user", content: "Recovered", timestamp: 2 },
      },
    ],
  });
  const session: ParakeetSession = {
    latestPending: () => Promise.resolve(null),
    withdraw: () => Promise.resolve({ status: "unknown" }),
    address: "test://parakeet/reconnect",
    command: commandHandler(commandResult),
    extension: noExtension,
    read: () => Promise.resolve(initialBaseline),
    watch: () => {
      const changes = queues[watchCount];
      watchCount += 1;
      if (changes === undefined)
        throw new Error("Unexpected additional Session watch");
      return Promise.resolve({
        snapshot: watchCount === 1 ? initialBaseline : reconnectedBaseline,
        changes,
        close: () => {
          closeCount += 1;
          return Promise.resolve();
        },
      });
    },
  };
  const container = mount(session, new QueryClient(), undefined, (outcome) =>
    outcomes.push(outcome),
  ).container;
  await settle();
  await settle();
  expect(container.firstElementChild?.getAttribute("data-observation")).toBe(
    "live",
  );
  expect(container.firstElementChild?.getAttribute("data-status")).toBe(
    "thinking",
  );
  expect(container.textContent).toContain("Keep this");

  await settle(() => {
    Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "Reconnect")
      ?.click();
  });
  await settle();
  expect(watchCount).toBe(1);
  expect(outcomes).toEqual([
    { kind: "nothing_to_reconnect", state: "connected" },
  ]);

  await settle(() => {
    firstChanges.fail(new Error("Session history is unavailable"));
  });
  await settle();
  expect(container.firstElementChild?.getAttribute("data-observation")).toBe(
    "unavailable",
  );
  expect(container.firstElementChild?.getAttribute("data-status")).toBe(
    "disconnected",
  );
  expect(container.firstElementChild?.getAttribute("data-view-state")).toBe(
    "disconnected",
  );
  expect(container.firstElementChild?.getAttribute("data-view-cause")).toBe(
    "Session history is unavailable",
  );
  expect(container.textContent).toContain("Keep this");
  expect(closeCount).toBe(1);

  await settle(() => {
    Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "Reconnect")
      ?.click();
  });
  await settle();
  expect(watchCount).toBe(2);
  expect(outcomes).toEqual([
    { kind: "nothing_to_reconnect", state: "connected" },
    { kind: "reconnected" },
  ]);
  expect(container.firstElementChild?.getAttribute("data-observation")).toBe(
    "live",
  );
  expect(container.firstElementChild?.getAttribute("data-status")).toBe("idle");
  expect(container.textContent).toContain("Keep this");
  expect(container.textContent).toContain("Recovered");
});

it("keeps an unresolved admission through reconnect, then retires its exact terminal", async () => {
  const firstChanges = frameQueue();
  const secondChanges = frameQueue();
  const changes = [firstChanges, secondChanges];
  const commands: PromptCommand[] = [];
  let watches = 0;
  const baseline = sessionSnapshot({ status: "idle" });
  const session: ParakeetSession = {
    latestPending: () => Promise.resolve(null),
    withdraw: () => Promise.resolve({ status: "unknown" }),
    address: "test://parakeet/reconnect-admission",
    command: commandHandler((input) => {
      commands.push(input);
      return Promise.resolve({
        status: "accepted",
        commandId: "owner-reconnect",
      });
    }),
    extension: noExtension,
    read: () => Promise.resolve(baseline),
    watch: () => {
      const current = changes[watches++];
      if (current === undefined) throw new Error("Unexpected watch");
      return watch(current, baseline);
    },
  };
  const container = render(session);
  await settle();
  await settle(() => {
    const input = container.querySelector('input[aria-label="Draft"]');
    if (!(input instanceof HTMLInputElement)) throw new Error("Missing draft");
    change(input, "A repeated message");
    container.querySelector<HTMLButtonElement>("button")?.click();
  });
  await settle();
  expect(commands).toHaveLength(1);
  expect(container.querySelector('[data-state="accepted"]')?.textContent).toBe(
    "A repeated message",
  );
  await settle(() => {
    firstChanges.fail(new Error("Watch disconnected"));
  });
  await settle();
  await settle(() => {
    [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Reconnect")
      ?.click();
  });
  await settle();
  expect(watches).toBe(2);
  expect(commands).toHaveLength(1);
  expect(container.querySelector('[data-state="accepted"]')?.textContent).toBe(
    "A repeated message",
  );
  await settle(() => {
    secondChanges.push(
      sessionFrame({
        kind: "update",
        delivery: "live",
        cursor: "after-terminal",
        messages: [],
        terminals: [{ commandId: "owner-reconnect", outcome: "completed" }],
        pending: { total: 0, prompts: [], hasMore: false },
        status: "idle",
      }),
    );
  });
  await settle();
  expect(container.querySelector('[data-kind="user_message"]')).toBeNull();
  expect(commands).toHaveLength(1);
  await settle(() => {
    secondChanges.push({
      kind: "reset",
      reason: "history_unavailable",
      cursor: "after-bounded-reset",
      baseline,
    });
  });
  await settle();
  expect(container.querySelector('[data-kind="user_message"]')).toBeNull();
  expect(commands).toHaveLength(1);
});

it("returns a typed cause when a failed Session watch cannot reconnect", async () => {
  const firstChanges = frameQueue();
  const outcomes: ParakeetReconnectOutcome[] = [];
  let watchCount = 0;
  const session: ParakeetSession = {
    latestPending: () => Promise.resolve(null),
    withdraw: () => Promise.resolve({ status: "unknown" }),
    address: "test://parakeet/reconnect-failure",
    command: commandHandler(commandResult),
    extension: noExtension,
    read: () => Promise.resolve(sessionSnapshot()),
    watch: () => {
      watchCount += 1;
      if (watchCount === 1) return watch(firstChanges);
      return Promise.reject(new Error("socket reset"));
    },
  };
  const container = mount(session, new QueryClient(), undefined, (outcome) =>
    outcomes.push(outcome),
  ).container;
  await settle();
  await settle(() => {
    firstChanges.fail(new Error("first watch closed"));
  });
  await settle();
  await settle(() => {
    Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "Reconnect")
      ?.click();
  });
  await settle();
  expect(watchCount).toBe(2);
  expect(outcomes).toEqual([{ kind: "failed", cause: "socket reset" }]);
  expect(container.firstElementChild?.getAttribute("data-observation")).toBe(
    "unavailable",
  );
});

it("preserves bounded durable item identities across progress revisions", async () => {
  const stableDurableRows: boolean[] = [];
  for (const messageCount of [200, 300]) {
    const changes = frameQueue();
    const observed: (readonly unknown[])[] = [];
    const session: ParakeetSession = {
      latestPending: () => Promise.resolve(null),
      withdraw: () => Promise.resolve({ status: "unknown" }),
      address: `test://parakeet/progress-${String(messageCount)}`,
      command: commandHandler(commandResult),
      extension: noExtension,
      read: () => Promise.resolve(sessionSnapshot()),
      watch: () =>
        watch(
          changes,
          sessionSnapshot({ messages: durableMessages(messageCount) }),
        ),
    };

    mount(session, new QueryClient(), (items) => observed.push(items));
    await settle();
    await settle();
    const durable = observed.at(-1);
    if (durable === undefined)
      throw new Error("Durable timeline is unavailable");
    expect(durable).toHaveLength(messageCount);

    for (const revision of [1, 2]) {
      await settle(() => {
        changes.push(
          sessionFrame({
            kind: "progress",
            status: "streaming",
            progress: {
              messageId: "live-assistant",
              revision,
              text: { offset: 0, append: `Progress ${String(revision)}` },
              thinking: { offset: 0, append: "" },
            },
          }),
        );
      });
      await settle();
      const progressItems = observed.at(-1);
      if (progressItems === undefined)
        throw new Error("Progress timeline is unavailable");
      const durableItems = progressItems.slice(0, -1);

      expect(durableItems).toHaveLength(messageCount);
      stableDurableRows.push(
        durableItems.every((item, index) => item === durable[index]),
      );
    }
  }
  expect(stableDurableRows).toEqual([true, true, true, true]);
});

it.each([200, 300])(
  "isolates draft and progress subscriptions with %i durable messages",
  async (messageCount) => {
    const changes = frameQueue();
    const baseline = sessionSnapshot({
      messages: durableMessages(messageCount),
      status: "streaming",
    });
    const session: ParakeetSession = {
      latestPending: () => Promise.resolve(null),
      withdraw: () => Promise.resolve({ status: "unknown" }),
      address: `test://parakeet/isolated-${String(messageCount)}`,
      command: commandHandler(commandResult),
      extension: noExtension,
      read: () => Promise.resolve(baseline),
      watch: () => watch(changes, baseline),
    };
    const counts: SubscriptionCounts = {
      composer: 0,
      settled: undefined,
      status: 0,
      timeline: 0,
    };
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.add(root);
    act(() => {
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <ParakeetProvider session={session} clients={probeClients}>
            <SubscriptionProbe counts={counts} />
          </ParakeetProvider>
        </QueryClientProvider>,
      );
    });
    await settle();
    await settle();
    const settled = counts.settled;
    const afterMount = { ...counts };
    const input = container.querySelector('input[aria-label="Isolated draft"]');
    if (!(input instanceof HTMLInputElement))
      throw new Error("Isolated draft is unavailable");

    await settle(() => {
      change(input, "Still responsive");
    });
    expect(counts.composer).toBeGreaterThan(afterMount.composer);
    expect(counts.timeline).toBe(afterMount.timeline);
    expect(counts.status).toBe(afterMount.status);

    const beforeProgress = { ...counts };
    await settle(() => {
      changes.push(
        sessionFrame({
          kind: "progress",
          status: "streaming",
          progress: {
            messageId: "live-assistant",
            revision: 1,
            text: { offset: 0, append: "A live tail" },
            thinking: { offset: 0, append: "" },
          },
        }),
      );
    });
    await settle();
    expect(counts.timeline).toBeGreaterThan(beforeProgress.timeline);
    expect(counts.composer).toBe(beforeProgress.composer);
    expect(counts.status).toBe(beforeProgress.status);
    expect(counts.settled).toBe(settled);
  },
);

it("reconciles one optimistic prompt and aborts through the host mutation cache and defaults", async () => {
  const changes = frameQueue();
  const commands: PromptCommand[] = [];
  let aborts = 0;
  let finishAbort!: () => void;
  const abortFinished = new Promise<undefined>((resolve) => {
    finishAbort = () => {
      resolve(undefined);
    };
  });
  let acceptAdmission!: (value: Accepted) => void;
  const admission = new Promise<Accepted>((resolve) => {
    acceptAdmission = resolve;
  });
  const session: ParakeetSession = {
    latestPending: () => Promise.resolve(null),
    withdraw: () => Promise.resolve({ status: "unknown" }),
    address: "test://parakeet/optimistic-session",
    command: commandHandler(
      (input) => {
        commands.push(input);
        return admission;
      },
      commandResult,
      async (input) => {
        aborts += 1;
        await abortFinished;
        return commandResult(input);
      },
    ),
    extension: noExtension,
    read: () => Promise.resolve(sessionSnapshot()),
    watch: () => watch(changes),
  };
  const onSuccess = vi.fn();
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { onSuccess } },
  });
  const container = mount(session, queryClient).container;
  await settle();
  const input = container.querySelector('input[aria-label="Draft"]');
  if (!(input instanceof HTMLInputElement))
    throw new Error("Draft input is unavailable");

  await settle(() => {
    change(input, "Inspect it");
    container.querySelector<HTMLButtonElement>("button")?.click();
  });
  expect(commands).toHaveLength(1);
  expect(container.querySelectorAll('[data-kind="user_message"]')).toHaveLength(
    1,
  );
  expect(
    container
      .querySelector('[data-kind="user_message"]')
      ?.getAttribute("data-state"),
  ).toBe("pending");
  expect(input.value).toBe("");

  const command = commands[0];
  if (command === undefined) throw new Error("Prompt was not submitted");
  await settle(() => {
    changes.push(
      sessionFrame({
        kind: "update",
        delivery: "live",
        cursor: null,
        messages: [],
        terminals: [],
        status: "queued",
        pending: {
          total: 1,
          prompts: [
            {
              requestId: "request-" + command.requestId,
              commandId: command.requestId,
              delivery: command.delivery,
              text: command.text,
            },
          ],
          hasMore: false,
        },
      }),
    );
    acceptAdmission({ status: "accepted", commandId: command.requestId });
  });
  await settle();
  expect(container.querySelectorAll('[data-kind="user_message"]')).toHaveLength(
    1,
  );
  expect(
    container
      .querySelector('[data-kind="user_message"]')
      ?.getAttribute("data-state"),
  ).toBe("queued");
  await settle(() => {
    changes.push(
      sessionFrame({
        pending: { total: 0, prompts: [], hasMore: false },
        kind: "update",
        delivery: "live",
        cursor: "cursor-1",
        terminals: [],
        messages: [
          {
            id: "message-1",
            sequence: 1,
            commandId: command.requestId,
            value: { role: "user", content: command.text, timestamp: 1 },
          },
        ],
        status: "thinking",
      }),
    );
  });
  await settle();

  expect(container.querySelectorAll('[data-kind="user_message"]')).toHaveLength(
    1,
  );
  expect(
    container
      .querySelector('[data-kind="user_message"]')
      ?.getAttribute("data-state"),
  ).toBe("confirmed");
  expect(container.firstElementChild?.getAttribute("data-status")).toBe(
    "thinking",
  );
  await settle(() => {
    const abort = container
      .querySelectorAll<HTMLButtonElement>("button")
      .item(2);
    abort.click();
    abort.click();
  });
  expect(aborts).toBe(1);
  const mutations = queryClient.getMutationCache().getAll();
  expect(mutations).toHaveLength(1);
  expect(mutations[0]?.state.status).toBe("pending");
  expect(onSuccess).not.toHaveBeenCalled();
  await settle(finishAbort);
  expect(mutations[0]?.state.status).toBe("success");
  expect(onSuccess).toHaveBeenCalledOnce();
});

it("prevents duplicate draft sends while allowing changed drafts during admission", async () => {
  const changes = frameQueue();
  const commands: PromptCommand[] = [];
  const acceptances: ((value: Accepted) => void)[] = [];
  const session: ParakeetSession = {
    latestPending: () => Promise.resolve(null),
    withdraw: () => Promise.resolve({ status: "unknown" }),
    address: "test://parakeet/concurrent-admissions",
    command: commandHandler((input) => {
      commands.push(input);
      return new Promise<Accepted>((resolve) => {
        acceptances.push(resolve);
      });
    }),
    extension: noExtension,
    read: () => Promise.resolve(sessionSnapshot()),
    watch: () => watch(changes),
  };
  const observed: (readonly TimelineItem[])[] = [];
  const container = mount(session, new QueryClient(), (items) => {
    observed.push(items);
  }).container;
  await settle();
  const input = container.querySelector('input[aria-label="Draft"]');
  if (!(input instanceof HTMLInputElement))
    throw new Error("Draft input is unavailable");

  await settle(() => {
    change(input, "First prompt");
    container.querySelector<HTMLButtonElement>("button")?.click();
  });
  await settle(() =>
    container.querySelector<HTMLButtonElement>("button")?.click(),
  );
  expect(commands).toHaveLength(1);
  await settle(() => {
    change(input, "Second prompt");
    container.querySelector<HTMLButtonElement>("button")?.click();
  });

  expect(commands.map(({ text }) => text)).toEqual([
    "First prompt",
    "Second prompt",
  ]);
  expect(
    observed.at(-1)?.filter((item) => item.kind === "user_message"),
  ).toHaveLength(2);

  const second = commands[1];
  const first = commands[0];
  const acceptSecond = acceptances[1];
  const acceptFirst = acceptances[0];
  if (
    second === undefined ||
    first === undefined ||
    acceptSecond === undefined ||
    acceptFirst === undefined
  )
    throw new Error("Both prompts must be admitted independently");

  await settle(() => {
    acceptSecond({ status: "accepted", commandId: "owner-second" });
  });
  await settle();
  expect(
    container
      .querySelector(`[data-id="${second.requestId}"]`)
      ?.getAttribute("data-state"),
  ).toBe("accepted");
  await settle(() => {
    acceptFirst({ status: "accepted", commandId: "owner-first" });
  });
  expect(container.querySelectorAll('[data-kind="user_message"]')).toHaveLength(
    2,
  );

  await settle(() => {
    changes.push(
      sessionFrame({
        kind: "update",
        delivery: "live",
        cursor: "both-admitted",
        messages: [],
        terminals: [],
        pending: {
          total: 2,
          prompts: [
            {
              requestId: "request-" + "owner-first",
              commandId: "owner-first",
              delivery: "steer",
              text: "First prompt",
            },
            {
              requestId: "request-" + "owner-second",
              commandId: "owner-second",
              delivery: "steer",
              text: "Second prompt",
            },
          ],
          hasMore: false,
        },
        status: "queued",
      }),
    );
  });
  await settle();
  expect(container.querySelectorAll('[data-kind="user_message"]')).toHaveLength(
    2,
  );
  expect(container.querySelector('[data-id="owner-first"]')).not.toBeNull();
  expect(container.querySelector('[data-id="owner-second"]')).not.toBeNull();
});

it("reconciles a watch-before-ack row by owner command id", async () => {
  const changes = frameQueue();
  const commands: PromptCommand[] = [];
  const acceptances: ((value: Accepted) => void)[] = [];
  const session: ParakeetSession = {
    latestPending: () => Promise.resolve(null),
    withdraw: () => Promise.resolve({ status: "unknown" }),
    address: "test://parakeet/watch-before-ack",
    command: commandHandler((input) => {
      commands.push(input);
      return new Promise<Accepted>((resolve) => {
        acceptances.push(resolve);
      });
    }),
    extension: noExtension,
    read: () => Promise.resolve(sessionSnapshot()),
    watch: () => watch(changes),
  };
  const container = render(session);
  await settle();
  const input = container.querySelector('input[aria-label="Draft"]');
  if (!(input instanceof HTMLInputElement))
    throw new Error("Draft input is unavailable");
  await settle(() => {
    change(input, "Visible before admission response");
    container.querySelector<HTMLButtonElement>("button")?.click();
  });
  const prompt = commands[0];
  if (prompt === undefined) throw new Error("Prompt was not submitted");

  await settle(() => {
    changes.push(
      sessionFrame({
        kind: "update",
        delivery: "live",
        cursor: "watched-first",
        messages: [],
        terminals: [],
        pending: {
          total: 1,
          prompts: [
            {
              requestId: "request-" + "owner-watched-first",
              commandId: "owner-watched-first",
              delivery: "steer",
              text: prompt.text,
            },
          ],
          hasMore: false,
        },
        status: "queued",
      }),
    );
  });
  await settle();
  expect(container.querySelectorAll('[data-kind="user_message"]')).toHaveLength(
    2,
  );
  expect(input.value).toBe("");
  await settle(() =>
    container.querySelector<HTMLButtonElement>("button")?.click(),
  );
  expect(commands).toHaveLength(1);

  await settle(() => {
    change(input, "");
    change(input, "Visible before admission response");
    container.querySelector<HTMLButtonElement>("button")?.click();
  });
  expect(commands).toHaveLength(2);
  await settle(() => {
    change(input, "New unsent draft");
  });

  await settle(() => {
    acceptances[0]?.({ status: "accepted", commandId: "owner-watched-first" });
  });
  expect(input.value).toBe("New unsent draft");
  await settle(() => {
    acceptances[1]?.({ status: "accepted", commandId: "owner-watched-second" });
  });
  expect(input.value).toBe("New unsent draft");
  expect(container.querySelectorAll('[data-kind="user_message"]')).toHaveLength(
    2,
  );
  expect(
    container.querySelector('[data-id="owner-watched-first"]'),
  ).not.toBeNull();
});

it("reconciles a public recorded entry before its reply without replacing newer text or image cargo", async () => {
  const address = "test://parakeet/public-recorded-before-reply";
  const observedRowCounts: number[] = [];
  const text = "  Exact recorded text\nincluding whitespace  ";
  const submittedImages: NonNullable<PromptCommand["images"]> = [
    { type: "image", data: "b3JpZ2luYWw=", mimeType: "image/png" },
  ];
  const newerImages: NonNullable<PromptCommand["images"]> = [
    { type: "image", data: "bmV3ZXI=", mimeType: "image/png" },
  ];
  draftJournal(address, localStorage).write({
    draft: text,
    images: submittedImages,
    pending: [],
  });
  const changes = frameQueue();
  let resolveReply:
    ((result: Readonly<{ status: "recorded" }>) => void) | undefined;
  const reply = new Promise<Readonly<{ status: "recorded" }>>((resolve) => {
    resolveReply = resolve;
  });
  const commands: PromptCommand[] = [];
  const withdraw = vi.fn<ParakeetSession["withdraw"]>(() =>
    Promise.reject(new Error("No withdrawal should be necessary")),
  );
  const session: ParakeetSession = {
    address,
    latestPending: () =>
      Promise.resolve({
        commandId: "newer-queued-command",
        requestId: "newer-queued-request",
        text: "Newer recalled text",
        images: newerImages,
        delivery: "followUp",
      }),
    withdraw,
    command: commandHandler((input) => {
      commands.push(input);
      return reply;
    }),
    extension: noExtension,
    read: () => Promise.resolve(sessionSnapshot()),
    watch: () => watch(changes),
  };
  let current: ComposerController | undefined;
  const composer = () => {
    if (current === undefined) throw new Error("Missing composer");
    return current;
  };
  const { container } = mount(
    session,
    new QueryClient(),
    (items) => {
      observedRowCounts.push(
        items.filter((item) => item.kind === "user_message").length,
      );
    },
    undefined,
    {
      onComposer: (value) => {
        current = value;
      },
    },
  );
  await settle();
  await settle(() => {
    composer().send();
  });
  const original = commands[0];
  if (original === undefined) throw new Error("Missing held prompt");
  expect(original.text).toBe(text);
  expect(original.images).toEqual(submittedImages);
  await act(async () => {
    expect(await composer().recall()).toBe("restored");
  });
  const newerText = "  Newer typing over recalled text  ";
  await settle(() => {
    composer().setDraft(newerText);
  });
  expect(composer().images).toEqual(newerImages);
  // The real public visitor projection carries the original sourceRequestId
  // as requestId, strips host metadata, and keeps recorded commandId null.
  await settle(() => {
    changes.push(
      sessionFrame({
        kind: "update",
        delivery: "live",
        cursor: "recorded-before-reply",
        messages: [
          {
            id: "public-recorded-entry",
            commandId: null,
            requestId: original.requestId,
            sequence: 1,
            value: { role: "user", content: text, timestamp: 1 },
          },
        ],
        terminals: [],
        pending: { total: 0, prompts: [], hasMore: false },
        status: "idle",
      }),
    );
  });
  expect(container.querySelectorAll('[data-kind="user_message"]')).toHaveLength(
    1,
  );
  await vi.waitFor(async () => {
    await settle();
    expect(
      container.querySelector('[data-id="public-recorded-entry"]')?.textContent,
    ).toBe(text);
  });
  const beforeReply = draftJournal(address, localStorage).read();
  expect(beforeReply.pending).toEqual([]);
  expect(beforeReply.draft).toBe(newerText);
  expect(beforeReply.images).toEqual(newerImages);
  await settle(() => {
    if (resolveReply === undefined) throw new Error("Reply was not held");
    resolveReply({ status: "recorded" });
  });
  expect(composer().draft).toBe(newerText);
  expect(composer().images).toEqual(newerImages);
  expect(container.querySelectorAll('[data-kind="user_message"]')).toHaveLength(
    1,
  );
  expect(draftJournal(address, localStorage).read()).toEqual(beforeReply);
  expect(observedRowCounts.every((count) => count <= 1)).toBe(true);
  expect(withdraw).not.toHaveBeenCalled();
  expect(commands).toHaveLength(1);
});

it("retires a lost-ack recorded admission by its real entry receipt and original composer request", async () => {
  const changes = frameQueue();
  const commands: PromptCommand[] = [];
  const entryId = "recorded-entry";
  const withdraw = vi.fn<ParakeetSession["withdraw"]>(() =>
    Promise.resolve({ status: "accepted", commandId: entryId }),
  );
  const session: ParakeetSession = {
    address: "test://parakeet/recorded-lost-ack",
    latestPending: () => Promise.resolve(null),
    withdraw,
    command: commandHandler((input) => {
      commands.push(input);
      return Promise.reject(new Error("Recorded response lost"));
    }),
    extension: noExtension,
    read: () => Promise.resolve(sessionSnapshot()),
    watch: () => watch(changes),
  };
  const { container } = mount(
    session,
    new QueryClient(),
    undefined,
    undefined,
    {
      draftStorage: localStorage,
    },
  );
  await settle();
  const input = container.querySelector('input[aria-label="Draft"]');
  if (!(input instanceof HTMLInputElement)) throw new Error("Missing composer");
  const text = "  Keep this held reply exact  ";
  await settle(() => {
    change(input, text);
    container.querySelector<HTMLButtonElement>("button")?.click();
  });
  await settle();
  const original = commands[0];
  if (original === undefined) throw new Error("Missing submitted prompt");
  expect(withdraw).toHaveBeenCalledExactlyOnceWith(original.requestId);
  expect(input.value).toBe("");
  await settle(() => {
    change(input, "Newer unsent text");
    changes.push(
      sessionFrame({
        kind: "update",
        delivery: "live",
        cursor: "recorded",
        messages: [
          {
            id: entryId,
            commandId: null,
            requestId: original.requestId,
            sequence: 1,
            value: { role: "user", content: text, timestamp: 1 },
          },
        ],
        terminals: [],
        pending: { total: 0, prompts: [], hasMore: false },
        status: "idle",
      }),
    );
  });
  await settle();
  expect(container.querySelectorAll('[data-kind="user_message"]')).toHaveLength(
    1,
  );
  expect(
    container.querySelector('[data-id="recorded-entry"]')?.textContent,
  ).toBe(text);
  expect(
    container.querySelector(`[data-id="${original.requestId}"]`),
  ).toBeNull();
  expect(container.querySelector('[data-state="failed"]')).toBeNull();
  expect(container.firstElementChild?.getAttribute("data-status")).toBe("idle");
  expect(input.value).toBe("Newer unsent text");
  expect(commands).toHaveLength(1);
  expect(localStorage.length).toBe(1);
  const saved = localStorage.getItem(localStorage.key(0) ?? "");
  if (saved === null) throw new Error("Missing admission journal");
  expect(
    z.object({ pending: z.array(z.unknown()) }).parse(JSON.parse(saved))
      .pending,
  ).toEqual([]);
});

it("keeps one failed prompt visible beside a later accepted prompt", async () => {
  const changes = frameQueue();
  const commands: PromptCommand[] = [];
  const acceptances: ((value: Accepted) => void)[] = [];
  const failures: ((reason: Error) => void)[] = [];
  const session: ParakeetSession = {
    latestPending: () => Promise.resolve(null),
    withdraw: () => Promise.resolve({ status: "unknown" }),
    address: "test://parakeet/mixed-admissions",
    command: commandHandler((input) => {
      commands.push(input);
      return new Promise<Accepted>((resolve, reject) => {
        acceptances.push(resolve);
        failures.push(reject);
      });
    }),
    extension: noExtension,
    read: () => Promise.resolve(sessionSnapshot()),
    watch: () => watch(changes),
  };
  const container = render(session);
  await settle();
  const input = container.querySelector('input[aria-label="Draft"]');
  if (!(input instanceof HTMLInputElement))
    throw new Error("Draft input is unavailable");
  await settle(() => {
    change(input, "First prompt fails");
    container.querySelectorAll<HTMLButtonElement>("button").item(0).click();
  });
  await settle(() => {
    change(input, "Second prompt is accepted");
    container.querySelectorAll<HTMLButtonElement>("button").item(0).click();
  });
  const rejectFirst = failures[0];
  const acceptSecond = acceptances[1];
  if (rejectFirst === undefined || acceptSecond === undefined)
    throw new Error("Both admissions must be submitted");
  await settle(() => {
    rejectFirst(new Error("first admission rejected"));
    acceptSecond({ status: "accepted", commandId: "owner-second" });
  });
  expect(commands.map(({ text }) => text)).toEqual([
    "First prompt fails",
    "Second prompt is accepted",
  ]);
  expect(container.firstElementChild?.getAttribute("data-failed")).toBe(
    "false",
  );
  const secondRequestId = commands[1]?.requestId;
  if (secondRequestId === undefined)
    throw new Error("Second prompt identity is missing");
  expect(
    container.querySelector(`[data-id="${secondRequestId}"]`),
  ).not.toBeNull();
  expect(
    container
      .querySelector(`[data-id="${secondRequestId}"]`)
      ?.getAttribute("data-state"),
  ).toBe("accepted");
  expect(
    container.querySelector('[data-state="failed"]')?.textContent,
  ).toContain("First prompt fails");
});

it("restores the exact refused draft after newer text without losing either", async () => {
  const changes = frameQueue();
  let refuse: ((reason: Error) => void) | undefined;
  const session: ParakeetSession = {
    latestPending: () => Promise.resolve(null),
    withdraw: () => Promise.resolve({ status: "unknown" }),
    address: "test://parakeet/restore-newer-draft",
    command: commandHandler(
      () =>
        new Promise<Accepted>((_resolve, reject) => {
          refuse = reject;
        }),
    ),
    extension: noExtension,
    read: () => Promise.resolve(sessionSnapshot()),
    watch: () => watch(changes),
  };
  const container = render(session);
  await settle();
  const input = container.querySelector('input[aria-label="Draft"]');
  if (!(input instanceof HTMLInputElement))
    throw new Error("Draft unavailable");
  await settle(() => {
    change(input, "  Original text  ");
    container.querySelector<HTMLButtonElement>("button")?.click();
  });
  expect(input.value).toBe("");
  await settle(() => {
    change(input, "Newer text");
  });
  if (refuse === undefined) throw new Error("Prompt was not dispatched");
  await settle(() => refuse?.(new Error("Not enough credit")));
  expect(container.firstElementChild?.getAttribute("data-draft")).toBe(
    "Newer text\n\n  Original text  ",
  );
  expect(
    container.querySelector('[data-state="failed"]')?.textContent,
  ).toContain("Original");
});

it("preserves a failed draft and retries with a fresh identity without replacing newer text", async () => {
  const changes = frameQueue();
  const commands: PromptCommand[] = [];
  const session: ParakeetSession = {
    latestPending: () => Promise.resolve(null),
    withdraw: () => Promise.resolve({ status: "unknown" }),
    address: "test://parakeet/retry-session",
    command: commandHandler((input) => {
      commands.push(input);
      return commands.length === 1
        ? Promise.reject(new Error("typed command failed"))
        : commandResult(input);
    }),
    extension: noExtension,
    read: () => Promise.resolve(sessionSnapshot()),
    watch: () => watch(changes),
  };
  const container = render(session);
  await settle();
  const input = container.querySelector('input[aria-label="Draft"]');
  if (!(input instanceof HTMLInputElement))
    throw new Error("Draft input is unavailable");

  await settle(() => {
    change(input, "Original draft");
    container.querySelector<HTMLButtonElement>("button")?.click();
  });
  await vi.waitFor(async () => {
    await settle();
    expect(container.firstElementChild?.getAttribute("data-failed")).toBe(
      "true",
    );
    expect(container.firstElementChild?.getAttribute("data-failure")).toBe(
      "admission",
    );
  });
  expect(input.value).toBe("Original draft");

  await settle(() => {
    change(input, "Newer draft");
    container.querySelectorAll<HTMLButtonElement>("button").item(1).click();
  });
  await vi.waitFor(async () => {
    await settle();
    expect(container.firstElementChild?.getAttribute("data-failed")).toBe(
      "false",
    );
  });
  expect(commands).toHaveLength(2);
  expect(commands[1]).toMatchObject({
    text: "Original draft",
    delivery: "steer",
  });
  expect(commands[1]?.requestId).not.toBe(commands[0]?.requestId);
  expect(input.value).toBe("Newer draft");
});

it("admission Retry preserves newer same-text image cargo restored by Recall", async () => {
  const address = "test://parakeet/admission-retry-newer-images";
  const text = "Compare this frame.";
  const newerImages: NonNullable<PromptCommand["images"]> = [
    {
      type: "image",
      mimeType: "image/png",
      data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6KQAAAABJRU5ErkJggg==",
    },
  ];
  const changes = frameQueue();
  const commands: PromptCommand[] = [];
  let refuse: ((reason: Error) => void) | undefined;
  const reply = new Promise<Accepted>((_resolve, reject) => {
    refuse = reject;
  });
  const session: ParakeetSession = {
    address,
    latestPending: () =>
      Promise.resolve({
        commandId: "newer-queued-command",
        requestId: "newer-queued-request",
        text,
        images: newerImages,
        delivery: "followUp",
      }),
    withdraw: () => Promise.resolve({ status: "unknown" }),
    command: commandHandler((input) => {
      commands.push(input);
      return commands.length === 1 ? reply : commandResult(input);
    }),
    extension: noExtension,
    read: () => Promise.resolve(sessionSnapshot()),
    watch: () => watch(changes),
  };
  let current: ComposerController | undefined;
  const composer = () => {
    if (current === undefined) throw new Error("Missing composer");
    return current;
  };
  const { container } = mount(
    session,
    new QueryClient(),
    undefined,
    undefined,
    {
      onComposer: (value) => {
        current = value;
      },
    },
  );
  await vi.waitFor(async () => {
    await settle();
    expect(container.firstElementChild?.getAttribute("data-status")).toBe(
      "idle",
    );
  });
  await settle(() => {
    composer().setDraft(text);
    composer().send();
  });
  expect(composer().draft).toBe("");
  expect(commands).toHaveLength(1);
  await act(async () => {
    expect(await composer().recall()).toBe("restored");
  });
  expect(composer().images).toEqual(newerImages);
  await settle(() => {
    if (refuse === undefined) throw new Error("Missing held admission");
    refuse(new Error("Prompt refused"));
  });
  await vi.waitFor(async () => {
    await settle();
    expect(composer().failure).toBe("admission");
  });
  // Keep the same words while editing the recovered draft. Its recalled image
  // is not part of the failed text-only admission.
  await settle(() => {
    composer().setDraft(text);
  });
  expect(composer().images).toEqual(newerImages);
  await settle(() => {
    container.querySelectorAll<HTMLButtonElement>("button").item(1).click();
  });
  expect(commands).toHaveLength(2);
  expect(commands[1]).toMatchObject({ text, delivery: "steer" });
  expect(commands[1]?.images).toBeUndefined();
  expect(commands[1]?.requestId).not.toBe(commands[0]?.requestId);
  expect(composer().draft).toBe(text);
  expect(composer().images).toEqual(newerImages);
  const persisted = draftJournal(address, localStorage).read();
  expect(persisted.draft).toBe(text);
  expect(persisted.images).toEqual(newerImages);
});

it.each([false, true])(
  "retry consumes an unchanged restored draft (images: %s) before admission completes",
  async (withImages) => {
    const changes = frameQueue();
    let attempts = 0;
    const commands: PromptCommand[] = [];
    const images: NonNullable<PromptCommand["images"]> = [
      {
        type: "image",
        mimeType: "image/png",
        data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6KQAAAABJRU5ErkJggg==",
      },
    ];
    const session: ParakeetSession = {
      latestPending: () => Promise.resolve(null),
      withdraw: () => Promise.resolve({ status: "unknown" }),
      address: "test://parakeet/retry-restored-draft",
      command: commandHandler((input) => {
        attempts += 1;
        commands.push(input);
        return attempts === 1
          ? Promise.reject(new Error("Refused"))
          : new Promise<Accepted>(() => undefined);
      }),
      extension: noExtension,
      read: () => Promise.resolve(sessionSnapshot()),
      watch: () => watch(changes),
    };
    if (withImages)
      draftJournal(session.address, localStorage).write({
        draft: "",
        images,
        pending: [],
      });
    let composer: ComposerController | undefined;
    const { container } = mount(
      session,
      new QueryClient(),
      undefined,
      undefined,
      {
        onComposer: (value) => {
          composer = value;
        },
      },
    );
    await settle();
    const input = container.querySelector('input[aria-label="Draft"]');
    if (!(input instanceof HTMLInputElement))
      throw new Error("Draft unavailable");
    await settle(() => {
      change(input, "Retry this draft");
      container.querySelector<HTMLButtonElement>("button")?.click();
    });
    expect(input.value).toBe("Retry this draft");
    expect(composer?.images).toEqual(withImages ? images : []);
    await settle(() => {
      container.querySelectorAll<HTMLButtonElement>("button").item(1).click();
    });
    expect(attempts).toBe(2);
    expect(input.value).toBe("");
    expect(composer?.images).toBeUndefined();
    expect(commands[1]?.images).toEqual(withImages ? images : undefined);
    expect(
      draftJournal(session.address, localStorage).read().images,
    ).toBeUndefined();
  },
);

it("lets the caller remove an abandoned failed admission", async () => {
  const changes = frameQueue();
  const session: ParakeetSession = {
    latestPending: () => Promise.resolve(null),
    withdraw: () => Promise.resolve({ status: "unknown" }),
    address: "test://parakeet/dismiss-failure",
    command: commandHandler(() =>
      Promise.reject(new Error("admission failed")),
    ),
    extension: noExtension,
    read: () => Promise.resolve(sessionSnapshot()),
    watch: () => watch(changes),
  };
  const container = render(session);
  await settle();
  const input = container.querySelector('input[aria-label="Draft"]');
  if (!(input instanceof HTMLInputElement))
    throw new Error("Draft input is unavailable");
  await settle(() => {
    change(input, "Abandoned failed prompt");
    container.querySelectorAll<HTMLButtonElement>("button").item(0).click();
  });
  await vi.waitFor(async () => {
    await settle();
    expect(container.querySelector('[data-state="failed"]')).not.toBeNull();
  });
  await settle(() => {
    container
      .querySelector<HTMLButtonElement>("[data-state=failed] button")
      ?.click();
  });
  expect(container.querySelector('[data-state="failed"]')).toBeNull();
  expect(container.firstElementChild?.getAttribute("data-failed")).toBe(
    "false",
  );
});

it("uses durable settlement for the newest request's failure and the owner's status for activity", async () => {
  const changes = frameQueue();
  const commands: PromptCommand[] = [];
  const session: ParakeetSession = {
    latestPending: () => Promise.resolve(null),
    withdraw: () => Promise.resolve({ status: "unknown" }),
    address: "test://parakeet/settlement",
    command: commandHandler((input) => {
      commands.push(input);
      return commandResult(input);
    }),
    extension: noExtension,
    read: () => Promise.resolve(sessionSnapshot()),
    watch: () => watch(changes),
  };
  const container = render(session);
  await settle();
  const input = container.querySelector('input[aria-label="Draft"]');
  if (!(input instanceof HTMLInputElement))
    throw new Error("Draft input is unavailable");
  const emit = async (
    text: string,
    outcome: "failed" | "cancelled" | "interrupted" | "completed",
    sequence: number,
  ) => {
    await settle(() => {
      change(input, text);
    });
    await settle(() => {
      container.querySelector<HTMLButtonElement>("button")?.click();
    });
    const requestId = commands.at(-1)?.requestId;
    expect(commands).toHaveLength(sequence);
    if (requestId === undefined) throw new Error("Prompt was not submitted");
    await settle();
    await settle(() => {
      changes.push(
        sessionFrame({
          pending: { total: 0, prompts: [], hasMore: false },
          kind: "update",
          delivery: "live",
          cursor: requestId,
          messages: [
            {
              id: requestId,
              commandId: requestId,
              sequence: sequence * 2 - 1,
              value: { role: "user", content: text, timestamp: sequence },
            },
          ],
          terminals: [
            { commandId: requestId, outcome, sequence: sequence * 2 },
          ],
          status: "idle",
        }),
      );
    });
    await settle();
  };
  await emit("failed", "failed", 1);
  expect(container.firstElementChild?.getAttribute("data-status")).toBe(
    "error",
  );
  expect(container.firstElementChild?.getAttribute("data-failure")).toBe(
    "failed",
  );
  await emit("cancelled", "cancelled", 2);
  expect(container.firstElementChild?.getAttribute("data-status")).toBe(
    "error",
  );
  expect(container.firstElementChild?.getAttribute("data-failure")).toBe(
    "cancelled",
  );
  await emit("interrupted", "interrupted", 3);
  expect(container.firstElementChild?.getAttribute("data-status")).toBe(
    "error",
  );
  await emit("completed", "completed", 4);
  expect(container.firstElementChild?.getAttribute("data-status")).toBe("idle");
  // A goal continuation runs without a newer user command: the newest terminal
  // is still `completed`, and Shiitake's status alone says work is active.
  await settle(() => {
    changes.push(
      sessionFrame({
        pending: { total: 0, prompts: [], hasMore: false },
        kind: "update",
        delivery: "live",
        cursor: "continuation",
        messages: [],
        terminals: [],
        status: "thinking",
      }),
    );
  });
  await vi.waitFor(() => {
    expect(container.firstElementChild?.getAttribute("data-status")).toBe(
      "thinking",
    );
  });
  expect(container.firstElementChild?.getAttribute("data-status")).toBe(
    "thinking",
  );
  expect(container.firstElementChild?.getAttribute("data-failed")).toBe(
    "false",
  );
  await settle(() => {
    changes.push(
      sessionFrame({
        pending: { total: 0, prompts: [], hasMore: false },
        kind: "update",
        delivery: "live",
        cursor: "external",
        messages: [
          {
            id: "external",
            commandId: "external",
            sequence: 5,
            value: { role: "user", content: "external", timestamp: 5 },
          },
        ],
        terminals: [{ commandId: "external", outcome: "completed" }],
        status: "idle",
      }),
    );
  });
  expect(container.firstElementChild?.getAttribute("data-failed")).toBe(
    "false",
  );
});

it.each(["interrupted", "failed"] as const)(
  "retries a %s durable prompt with a fresh request identity",
  async (outcome) => {
    const changes = frameQueue();
    const commands: PromptCommand[] = [];
    const session: ParakeetSession = {
      latestPending: () => Promise.resolve(null),
      withdraw: () => Promise.resolve({ status: "unknown" }),
      address: `test://parakeet/${outcome}-retry`,
      command: commandHandler((input) => {
        commands.push(input);
        return commandResult(input);
      }),
      extension: noExtension,
      read: () => Promise.resolve(sessionSnapshot()),
      watch: () => watch(changes),
    };
    const container = render(session);
    await settle();
    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="Draft"]',
    );
    if (!input) throw new Error("Draft input is unavailable");
    await settle(() => {
      change(input, "Original prompt");
    });
    await settle(() => {
      container.querySelector<HTMLButtonElement>("button")?.click();
    });
    const first = commands[0];
    if (!first) throw new Error("Prompt was not submitted");
    await settle(() => {
      changes.push(
        sessionFrame({
          kind: "update",
          delivery: "live",
          cursor: first.requestId,
          messages: [
            {
              id: first.requestId,
              commandId: first.requestId,
              sequence: 1,
              value: { role: "user", content: "Original prompt", timestamp: 1 },
            },
          ],
          terminals: [{ commandId: first.requestId, outcome }],
          pending: { total: 0, prompts: [], hasMore: false },
          status: "idle",
        }),
      );
    });
    await settle(() => {
      change(input, "New draft");
    });
    await settle(() => {
      container.querySelectorAll<HTMLButtonElement>("button").item(1).click();
    });
    expect(commands).toHaveLength(2);
    expect(commands[1]).toMatchObject({
      text: "Original prompt",
      delivery: "followUp",
    });
    expect(commands[1]?.requestId).not.toBe(first.requestId);
    expect(input.value).toBe("New draft");
  },
);

it("restores admitted prompts without local submissions or an older failure hiding current activity", async () => {
  const changes = frameQueue();
  const snapshot = sessionSnapshot({
    status: "queued",
    messages: [
      {
        id: "old",
        sequence: 1,
        commandId: "old",
        value: { role: "user", content: "Older request", timestamp: 1 },
      },
    ],
    terminals: [{ commandId: "old", outcome: "failed" }],
    pending: {
      total: 2,
      prompts: [
        {
          requestId: "request-" + "remote-one",
          commandId: "remote-one",
          delivery: "followUp",
          text: "First waiting task",
        },
        {
          requestId: "request-" + "remote-two",
          commandId: "remote-two",
          delivery: "followUp",
          text: "Second waiting task",
        },
      ],
      hasMore: false,
    },
  });
  const session: ParakeetSession = {
    latestPending: () => Promise.resolve(null),
    withdraw: () => Promise.resolve({ status: "unknown" }),
    address: "test://parakeet/restored-admissions",
    command: commandHandler(commandResult),
    extension: noExtension,
    read: () => Promise.resolve(snapshot),
    watch: () => watch(changes, snapshot),
  };
  const container = render(session);
  await vi.waitFor(async () => {
    await settle();
    expect(container.firstElementChild?.getAttribute("data-status")).toBe(
      "queued",
    );
  });
  expect(
    [...container.querySelectorAll('[data-state="queued"]')].map(
      (row) => row.textContent,
    ),
  ).toEqual(["First waiting task", "Second waiting task"]);
});

it("clears the submitted draft after admission while preserving its exact raw text", async () => {
  const changes = frameQueue();
  const commands: PromptCommand[] = [];
  const session: ParakeetSession = {
    latestPending: () => Promise.resolve(null),
    withdraw: () => Promise.resolve({ status: "unknown" }),
    address: "test://parakeet/whitespace-draft",
    extension: noExtension,
    command: commandHandler((input) => {
      commands.push(input);
      return commandResult(input);
    }),
    read: () => Promise.resolve(sessionSnapshot()),
    watch: () => watch(changes),
  };
  const container = render(session);
  await settle();
  const input = container.querySelector('input[aria-label="Draft"]');
  if (!(input instanceof HTMLInputElement))
    throw new Error("Draft input unavailable");
  await settle(() => {
    change(input, "  Keep these words  ");
  });
  await settle(() =>
    container.querySelector<HTMLButtonElement>("button")?.click(),
  );
  await settle();
  expect(commands[0]?.text).toBe("  Keep these words  ");
  expect(input.value).toBe("");
});

function goalSession(
  address: string,
  goal: FixtureGoal,
  status: FixtureStatus = "idle",
) {
  const changes = frameQueue();
  const snapshot = sessionSnapshot({
    sessionId: address,
    extensions: goalSlots(goal),
    status,
  });
  const pause = vi.fn((): Promise<FixtureGoal> =>
    Promise.resolve({ ...goal, state: "paused" }),
  );
  const resume = vi.fn((): Promise<FixtureGoal> =>
    Promise.resolve({ ...goal, state: "active" }),
  );
  const abort = vi.fn(() => Promise.resolve(undefined));
  const session: ParakeetSession = {
    latestPending: () => Promise.resolve(null),
    withdraw: () => Promise.resolve({ status: "unknown" }),
    address,
    command: commandHandler(commandResult, abort),
    extension: extensionCalls({
      [goalContract.id]: {
        change: async (input) => {
          const { action } = z
            .object({ action: z.enum(["pause", "resume"]) })
            .parse(input);
          const result = await (action === "pause" ? pause() : resume());
          return { type: "done", result: committedGoal(result) };
        },
      },
    }),
    read: () => Promise.resolve(snapshot),
    watch: () => watch(changes, snapshot),
  };
  return {
    session,
    pause,
    resume,
    abort,
    observe(state: FixtureGoal["state"]) {
      changes.push(
        sessionFrame({
          kind: "update",
          delivery: "live",
          cursor: null,
          messages: [],
          terminals: [],
          status: "idle",
          pending: { total: 0, prompts: [], hasMore: false },
          extensions: goalSlots({ ...goal, state }),
        }),
      );
    },
  };
}

function goalButton(container: HTMLElement): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(
    '[aria-label="Session goal"] button',
  );
  if (button === null) throw new Error("Goal action is missing");
  return button;
}

it("waits for observed goal changes, never infers completion from idle or aborts work", async () => {
  const target = goalSession(
    "test://parakeet/live-goal",
    {
      revision: "goal-revision",
      objective: "Finish the useful work",
      state: "active",
    },
    "thinking",
  );
  const container = render(target.session);
  await settle();
  await settle();
  expect(container.firstElementChild?.getAttribute("data-status")).toBe(
    "thinking",
  );
  expect(goalButton(container).textContent).toContain("Pause goal");
  let finish: (() => void) | undefined;
  target.pause.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = () => {
          resolve({
            revision: "goal-revision",
            objective: "Finish the useful work",
            state: "paused",
          });
        };
      }),
  );
  await settle(() => {
    goalButton(container).click();
  });
  await settle();
  expect(goalButton(container).disabled).toBe(true);
  expect(target.pause).toHaveBeenCalledTimes(1);
  expect(target.abort).not.toHaveBeenCalled();
  await settle(() => finish?.());
  await settle();
  expect(goalButton(container).textContent).toContain("Pause goal");
  await settle(() => {
    target.observe("paused");
  });
  await settle();
  expect(goalButton(container).textContent).toContain("Resume goal");
  expect(container.firstElementChild?.getAttribute("data-status")).toBe("idle");
  await settle(() => {
    goalButton(container).click();
  });
  expect(target.resume).toHaveBeenCalledTimes(1);
  await settle(() => {
    target.observe("complete");
  });
  await settle();
  expect(
    container.querySelector('[aria-label="Session goal"]')?.textContent,
  ).toContain("complete");
  expect(
    container.querySelector('[aria-label="Session goal"] button'),
  ).toBeNull();
});

it("shows a rejected action without changing the goal and permits retry", async () => {
  const target = goalSession("test://parakeet/rejected-goal", {
    revision: "goal-revision",
    objective: "Keep working",
    state: "active",
  });
  target.pause.mockRejectedValueOnce(new Error("Goal pause was rejected"));
  const container = render(target.session);
  await settle();
  await settle();
  await settle(() => {
    goalButton(container).click();
  });
  await settle();
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    "Goal pause was rejected",
  );
  expect(goalButton(container).disabled).toBe(false);
  expect(goalButton(container).textContent).toContain("Pause goal");
  await settle(() => {
    goalButton(container).click();
  });
  await settle();
  expect(target.pause).toHaveBeenCalledTimes(2);
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it("keeps a pending or rejected old Session action out of the newly selected Session", async () => {
  const first = goalSession("test://parakeet/old-goal", {
    revision: "old-revision",
    objective: "Old work",
    state: "active",
  });
  const second = goalSession("test://parakeet/new-goal", {
    revision: "new-revision",
    objective: "Current work",
    state: "paused",
  });
  let rejectOld: ((error: Error) => void) | undefined;
  first.pause.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        rejectOld = reject;
      }),
  );
  const queryClient = new QueryClient();
  const { container, root } = mount(first.session, queryClient);
  await settle();
  await settle();
  await settle(() => {
    goalButton(container).click();
  });
  await settle();
  expect(goalButton(container).disabled).toBe(true);
  await settle(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <ParakeetProvider session={second.session} clients={probeClients}>
          <ControllerProbe />
        </ParakeetProvider>
      </QueryClientProvider>,
    );
  });
  await settle();
  await settle();
  expect(container.textContent).toContain("Current work");
  expect(container.textContent).not.toContain("Old work");
  expect(goalButton(container).disabled).toBe(false);
  await settle(() => rejectOld?.(new Error("Old Session rejected pause")));
  await settle();
  expect(container.querySelector('[role="alert"]')).toBeNull();
  await settle(() => {
    goalButton(container).click();
  });
  expect(second.resume).toHaveBeenCalledTimes(1);
  expect(first.resume).not.toHaveBeenCalled();
  expect(second.pause).not.toHaveBeenCalled();
});

it.each(["blocked", "complete"] as const)(
  "shows an observed %s goal without inventing an action",
  async (state) => {
    const target = goalSession(`test://parakeet/${state}-goal`, {
      revision: "goal-revision",
      objective: "Retained objective",
      state,
    });
    const container = render(target.session);
    await settle();
    await settle();
    expect(
      container.querySelector('[aria-label="Session goal"]')?.textContent,
    ).toContain("Retained objective");
    expect(
      container.querySelector('[aria-label="Session goal"] button'),
    ).toBeNull();
    expect(target.pause).not.toHaveBeenCalled();
    expect(target.resume).not.toHaveBeenCalled();
  },
);

it("preserves explicit follow-up intent with a fresh identity after withdrawal", async () => {
  const changes = frameQueue();
  const sent: PromptCommand[] = [];
  const session: ParakeetSession = {
    latestPending: () => Promise.resolve(null),
    withdraw: () => Promise.resolve({ status: "unknown" }),
    address: "test://parakeet/follow-up",
    command: commandHandler((input) => {
      sent.push(input);
      return sent.length === 1
        ? Promise.reject(new Error("response lost"))
        : commandResult(input);
    }),
    extension: noExtension,
    read: () => Promise.resolve(sessionSnapshot()),
    watch: () => watch(changes),
  };
  const container = render(session);
  await settle();
  const input = container.querySelector('input[aria-label="Draft"]');
  if (!(input instanceof HTMLInputElement)) throw new Error("Missing composer");
  await settle(() => {
    change(input, "Do this afterward");
  });
  await settle(() => {
    Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "Queue")
      ?.click();
  });
  await settle();
  await settle(() => {
    Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "Retry")
      ?.click();
  });
  expect(sent).toHaveLength(2);
  expect(sent[0]?.delivery).toBe("followUp");
  expect(sent[1]).toMatchObject({
    type: "prompt",
    text: "Do this afterward",
    delivery: "followUp",
  });
  expect(sent[1]?.requestId).not.toBe(sent[0]?.requestId);
});

it("marks an ended owner watch unavailable instead of retaining Working", async () => {
  const baseline = sessionSnapshot({ status: "thinking" });
  const session: ParakeetSession = {
    latestPending: () => Promise.resolve(null),
    withdraw: () => Promise.resolve({ status: "unknown" }),
    address: "test://parakeet/ended-watch",
    command: commandHandler(commandResult),
    extension: noExtension,
    read: () => Promise.resolve(baseline),
    watch: () =>
      Promise.resolve({
        snapshot: baseline,
        changes: (async function* () {
          await Promise.resolve();
          yield* [];
        })(),
        close: () => Promise.resolve(),
      }),
  };
  const { container } = mount(session, new QueryClient());
  await settle();
  await settle();
  expect(container.firstElementChild?.getAttribute("data-view-state")).toBe(
    "disconnected",
  );
});

it("does not report idle before the Session owner supplies its first watch", async () => {
  const changes = frameQueue();
  let openWatch: ((watch: SessionWatch) => void) | undefined;
  const pendingWatch = new Promise<SessionWatch>((resolve) => {
    openWatch = resolve;
  });
  const session: ParakeetSession = {
    latestPending: () => Promise.resolve(null),
    withdraw: () => Promise.resolve({ status: "unknown" }),
    address: "test://parakeet/connecting",
    command: commandHandler(commandResult),
    extension: noExtension,
    read: () => Promise.resolve(sessionSnapshot()),
    watch: () => pendingWatch,
  };
  const { container } = mount(session, new QueryClient());
  await settle();
  expect(container.firstElementChild?.getAttribute("data-status")).toBe(
    "connecting",
  );
  expect(container.firstElementChild?.getAttribute("data-view-state")).toBe(
    "connecting",
  );
  await settle(() =>
    openWatch?.({
      snapshot: sessionSnapshot({ status: "thinking" }),
      changes,
      close: () => Promise.resolve(),
    }),
  );
  await settle();
  expect(container.firstElementChild?.getAttribute("data-status")).toBe(
    "thinking",
  );
});

it("keeps the owner's failed status when the failed prompt is outside the loaded page", async () => {
  const changes = frameQueue();
  const baseline = sessionSnapshot({
    terminals: [
      {
        commandId: "older-command",
        outcome: "failed",
        diagnostic: "Provider stopped",
        sequence: 9,
      },
    ],
  });
  const session: ParakeetSession = {
    latestPending: () => Promise.resolve(null),
    withdraw: () => Promise.resolve({ status: "unknown" }),
    address: "test://parakeet/failed-owner",
    command: commandHandler(commandResult),
    extension: noExtension,
    read: () => Promise.resolve(baseline),
    watch: () => watch(changes, baseline),
  };
  const { container } = mount(session, new QueryClient());
  await settle();
  await settle();
  expect(container.firstElementChild?.getAttribute("data-view-state")).toBe(
    "error",
  );
  expect(container.firstElementChild?.getAttribute("data-status")).toBe(
    "error",
  );
});

it("sends images the person attached with the draft and keeps them in the draft journal", async () => {
  const address = "test://parakeet/attached-images";
  const images: NonNullable<PromptCommand["images"]> = [
    { type: "image", data: "YXR0YWNoZWQ=", mimeType: "image/png" },
  ];
  const commands: PromptCommand[] = [];
  const session: ParakeetSession = {
    address,
    latestPending: () => Promise.resolve(null),
    withdraw: () => Promise.reject(new Error("No withdrawal expected")),
    command: commandHandler((input) => {
      commands.push(input);
      return new Promise<Accepted>(() => undefined);
    }),
    extension: noExtension,
    read: () => Promise.resolve(sessionSnapshot()),
    watch: () => watch(frameQueue()),
  };
  let current: ComposerController | undefined;
  const composer = () => {
    if (current === undefined) throw new Error("Missing composer");
    return current;
  };
  mount(session, new QueryClient(), undefined, undefined, {
    onComposer: (value) => {
      current = value;
    },
  });
  await settle();
  await settle(() => {
    composer().setImages(images);
  });
  expect(composer().images).toEqual(images);
  expect(draftJournal(address, localStorage).read().images).toEqual(images);
  await settle(() => {
    composer().setDraft("Look at this layout");
  });
  await settle(() => {
    composer().send();
  });
  expect(commands[0]?.text).toBe("Look at this layout");
  expect(commands[0]?.images).toEqual(images);
  await settle(() => {
    composer().setImages([]);
  });
  expect(composer().images).toBeUndefined();
});
