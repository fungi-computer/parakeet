// @vitest-environment jsdom
import { PassThrough } from "node:stream";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
  PromptCommand,
  SessionMessage,
  SessionSnapshot,
} from "@fungi.computer/shiitake/client";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { ParakeetProvider, useComposer, useTimeline } from "../src/headless.js";
import { RunFailureNotice } from "../src/components/RunFailureNotice.js";
import { draftJournal } from "../src/core/draft-storage.js";
import type { ParakeetSession } from "../src/session.js";
import {
  commandHandler,
  commandResult,
  noExtension,
  sessionFrame,
  sessionSnapshot,
} from "./fixtures/session.fixture.js";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
  writable: true,
});

const roots = new Set<Root>();
const clients = new Set<QueryClient>();
afterEach(async () => {
  await act(async () => {
    for (const root of roots) root.unmount();
    for (const client of clients) client.clear();
    await Promise.resolve();
  });
  roots.clear();
  clients.clear();
  document.body.replaceChildren();
  localStorage.clear();
});

const images: NonNullable<PromptCommand["images"]> = [
  {
    type: "image",
    mimeType: "image/png",
    data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  },
];

/** Same failure control and composer operation as the browser conversation. */
function FailedTurn({
  onRows,
  onComposer,
}: {
  onRows: (rows: ReturnType<typeof useTimeline>["settled"]) => void;
  onComposer?: (composer: ReturnType<typeof useComposer>) => void;
}) {
  const composer = useComposer();
  onComposer?.(composer);
  const timeline = useTimeline();
  onRows(timeline.settled);
  return (
    <>
      <input
        aria-label="Draft"
        value={composer.draft}
        onChange={(event) => {
          composer.setDraft(event.target.value);
        }}
      />
      {composer.failure === undefined ? null : (
        <RunFailureNotice failure={composer.failure} onRetry={composer.retry} />
      )}
    </>
  );
}

const newerImages: NonNullable<PromptCommand["images"]> = [
  {
    type: "image",
    mimeType: "image/png",
    data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6KQAAAABJRU5ErkJggg==",
  },
];
for (const example of [
  {
    name: "consuming an unchanged restored image draft",
    restoredImages: images,
    expectedDraft: "",
    expectedImages: undefined,
  },
  {
    name: "without consuming a same-text draft with newer images",
    restoredImages: newerImages,
    expectedDraft: "Compare this frame.",
    expectedImages: newerImages,
  },
]) {
  it(`retries the failed cargo ${example.name}`, async () => {
    const address = "test://executed-retry/newer-image-draft";
    const text = "Compare this frame.";
    draftJournal(address, localStorage).write({
      draft: text,
      images: example.restoredImages,
      pending: [],
    });
    const snapshot = sessionSnapshot({
      messages: [
        {
          id: "failed-user",
          requestId: "failed-request",
          commandId: "failed-command",
          sequence: 1,
          value: {
            role: "user",
            content: [{ type: "text", text }, ...images],
            timestamp: 1,
          },
        },
      ],
      terminals: [
        { commandId: "failed-command", outcome: "failed", sequence: 2 },
      ],
    });
    const changes = new PassThrough({ objectMode: true });
    const command = vi.fn<Parameters<typeof commandHandler>[0]>(commandResult);
    const session: ParakeetSession = {
      address,
      command: commandHandler(command),
      extension: noExtension,
      read: () => Promise.resolve(snapshot),
      latestPending: () => Promise.resolve(null),
      withdraw: () => Promise.reject(new Error("Retry must not withdraw work")),
      watch: () =>
        Promise.resolve({
          snapshot,
          changes,
          close: () => {
            changes.end();
            return Promise.resolve();
          },
        }),
    };
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    clients.add(client);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.add(root);
    let composer: ReturnType<typeof useComposer> | undefined;
    await settle(() => {
      root.render(
        <QueryClientProvider client={client}>
          <ParakeetProvider session={session}>
            <FailedTurn
              onRows={() => undefined}
              onComposer={(value) => {
                composer = value;
              }}
            />
          </ParakeetProvider>
        </QueryClientProvider>,
      );
    });
    await vi.waitFor(async () => {
      await settle();
      expect(
        container.querySelector('button[aria-label="Retry prompt"]'),
      ).not.toBeNull();
    });
    expect(composer?.draft).toBe(text);
    expect(composer?.images).toEqual(example.restoredImages);
    await settle(() => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Retry prompt"]')
        ?.click();
    });
    expect(command).toHaveBeenCalledTimes(1);
    expect(command.mock.calls[0]?.[0]).toMatchObject({ text, images });
    expect(composer?.draft).toBe(example.expectedDraft);
    expect(composer?.images).toEqual(example.expectedImages);
    const persisted = draftJournal(address, localStorage).read();
    expect(persisted.draft).toBe(example.expectedDraft);
    expect(persisted.images).toEqual(example.expectedImages);
  });
}

async function settle(operation?: () => void): Promise<void> {
  await act(async () => {
    operation?.();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

for (const outcome of ["failed", "interrupted"] satisfies (
  "failed" | "interrupted"
)[]) {
  for (const evicted of [false, true]) {
    for (const text of ["  Retry this exact attached frame.  ", ""]) {
      it(`retries ${outcome} ${text === "" ? "image-only" : "text/image"} cargo through the real control${evicted ? " after live-page eviction" : ""}, without consuming newer typing`, async () => {
        const changes = new PassThrough({ objectMode: true });
        const command =
          vi.fn<Parameters<typeof commandHandler>[0]>(commandResult);
        const prompt: SessionMessage = {
          id: "failed-user",
          commandId: "running-command",
          requestId: "original-admission",
          sequence: 1,
          value: {
            role: "user",
            content: [{ type: "text", text }, ...images],
            timestamp: 1,
          },
        };
        const messages: SessionMessage[] = [prompt];
        let finished = false;
        const snapshot = (): SessionSnapshot =>
          sessionSnapshot({
            status: finished ? "idle" : "streaming",
            cursor: `seq-${String(messages.length)}`,
            oldestCursor: `seq-${String(Math.max(1, messages.length - 199))}`,
            hasMore: messages.length > 200,
            messages: messages.slice(-200),
            terminals: finished
              ? [{ commandId: "running-command", outcome, sequence: 452 }]
              : [],
          });
        const read = vi.fn(() => Promise.resolve(snapshot()));
        const session: ParakeetSession = {
          address: `test://executed-retry/${outcome}/${String(evicted)}/${text === "" ? "image-only" : "text-image"}`,
          command: commandHandler(command),
          extension: noExtension,
          latestPending: () =>
            Promise.reject(new Error("Settled retry is not pending Recall")),
          withdraw: () =>
            Promise.reject(new Error("Retry must not withdraw accepted work")),
          read,
          watch: () =>
            Promise.resolve({
              snapshot: snapshot(),
              changes,
              close: () => {
                changes.end();
                return Promise.resolve();
              },
            }),
        };
        const client = new QueryClient({
          defaultOptions: { queries: { retry: false } },
        });
        clients.add(client);
        const container = document.createElement("div");
        document.body.append(container);
        const root = createRoot(container);
        roots.add(root);
        let rows: ReturnType<typeof useTimeline>["settled"] = [];
        await settle(() => {
          root.render(
            <QueryClientProvider client={client}>
              <ParakeetProvider session={session}>
                <FailedTurn
                  onRows={(next) => {
                    rows = next;
                  }}
                />
              </ParakeetProvider>
            </QueryClientProvider>,
          );
        });
        await vi.waitFor(async () => {
          await settle();
          expect(rows.some(({ id }) => id === prompt.id)).toBe(true);
        });

        if (evicted) {
          for (let batch = 0; batch < 5; batch++) {
            const results: SessionMessage[] = Array.from(
              { length: 90 },
              (_, index) => {
                const sequence = batch * 90 + index + 2;
                return {
                  id: `result-${String(sequence)}`,
                  commandId: "running-command",
                  sequence,
                  data: {},
                  value: {
                    role: "toolResult",
                    toolCallId: `call-${String(sequence)}`,
                    toolName: "execute",
                    content: [{ type: "text", text: "done" }],
                    isError: false,
                    timestamp: sequence,
                  },
                };
              },
            );
            messages.push(...results);
            await settle(() => {
              changes.write(
                sessionFrame({
                  kind: "update",
                  delivery: "live",
                  cursor: `seq-${String(messages.length)}`,
                  messages: results,
                  terminals: [],
                  pending: { total: 0, prompts: [], hasMore: false },
                  status: "streaming",
                }),
              );
            });
          }
          await vi.waitFor(async () => {
            await settle();
            expect(read).toHaveBeenCalled();
            expect(rows.some(({ id }) => id === prompt.id)).toBe(false);
          });
        }
        finished = true;
        await settle(() => {
          changes.write(
            sessionFrame({
              kind: "update",
              delivery: "live",
              cursor: "seq-452",
              messages: [],
              terminals: snapshot().terminals,
              pending: { total: 0, prompts: [], hasMore: false },
              status: "idle",
            }),
          );
        });
        await vi.waitFor(async () => {
          await settle();
          expect(
            container.querySelector('button[aria-label="Retry prompt"]'),
          ).not.toBeNull();
        });
        const input = container.querySelector("input");
        if (input === null) throw new Error("Draft input is unavailable");
        await settle(() => {
          const setValue = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            "value",
          )?.set?.bind(input);
          if (setValue === undefined)
            throw new Error("Input setter unavailable");
          setValue("A newer unsent draft");
          input.dispatchEvent(new Event("input", { bubbles: true }));
        });
        await settle(() => {
          container
            .querySelector<HTMLButtonElement>(
              'button[aria-label="Retry prompt"]',
            )
            ?.click();
        });
        expect(command).toHaveBeenCalledTimes(1);
        const submitted = command.mock.calls[0]?.[0];
        expect(submitted).toMatchObject({ text, images });
        expect(submitted?.requestId).toBeTruthy();
        expect(submitted?.requestId).not.toBe(prompt.requestId);
        expect(input.value).toBe("A newer unsent draft");
      });
    }
  }
}
