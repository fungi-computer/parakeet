import type { SessionMessage } from "@fungi.computer/shiitake/client";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { SessionFrame } from "@fungi.computer/shiitake/client";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import { TimelineItem } from "../src/components/TimelineItem.js";
import {
  initialToolDisclosure,
  toggleDisclosure,
  toolGroup,
} from "../src/core/tool-groups.js";
import * as highlighting from "@fungi.computer/caps/lib/tanstack-highlight";
import { Parakeet } from "../src/parakeet.js";
import type { ParakeetSession } from "../src/session.js";
import type {
  TimelineItem as ParakeetTimelineRow,
  ToolItem,
} from "../src/store/types.js";
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
    await Promise.resolve();
  });
  for (const client of clients) client.clear();
  roots.clear();
  clients.clear();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function mount() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.add(root);
  return { container, root };
}

it.each([false, true])(
  "shows collision suffixes only in an opted-in member view (visitor=%s)",
  async (visitor) => {
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(800);
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(800);
    const messages = ["user_ada_one", "user_ada_two"].map((id, index) => ({
      id,
      sequence: index + 1,
      commandId: null,
      meta: { author: { id, name: "Ada" } },
      value: {
        role: "user" as const,
        content: "A reply",
        timestamp: index + 1,
      },
    }));
    const snapshot = sessionSnapshot({
      messages: messages.slice(0, 1),
      status: "idle",
    });
    let receive: ((result: IteratorResult<SessionFrame>) => void) | undefined;
    const session: ParakeetSession = {
      latestPending: () => Promise.resolve(null),
      withdraw: () => Promise.resolve({ status: "unknown" }),
      address: "test://parakeet/author-labels",
      command: commandHandler(commandResult),
      extension: noExtension,
      read: () => Promise.resolve(snapshot),
      watch: () =>
        Promise.resolve({
          snapshot,
          changes: {
            [Symbol.asyncIterator]: () => ({
              next: () =>
                new Promise((resolve) => {
                  receive = resolve;
                }),
            }),
          },
          close: () => {
            receive?.({ done: true, value: undefined });
            return Promise.resolve();
          },
        }),
    };
    const client = new QueryClient();
    clients.add(client);
    const { container, root } = mount();
    await settle(() => {
      root.render(
        <QueryClientProvider client={client}>
          <Parakeet
            session={session}
            authorOf={readAuthor}
            disambiguateAuthors
            visitor={visitor ? { agentName: "Front Desk" } : undefined}
          />
        </QueryClientProvider>,
      );
    });
    await vi.waitFor(async () => {
      await settle();
      expect(
        [...container.querySelectorAll("[data-author]")].map(
          (element) => element.textContent,
        ),
      ).toEqual(["Ada"]);
      expect(receive).toBeDefined();
    });
    await settle(() =>
      receive?.({
        done: false,
        value: {
          ...snapshot,
          kind: "update",
          delivery: "live",
          cursor: "cursor-two",
          messages: messages.slice(1),
        },
      }),
    );
    await vi.waitFor(async () => {
      await settle();
      expect(
        [...container.querySelectorAll("[data-author]")].map(
          (element) => element.textContent,
        ),
      ).toEqual(visitor ? ["Ada", "Ada"] : ["Ada · da_one", "Ada · da_two"]);
    });
  },
);

const AuthorMeta = Schema.Struct({
  author: Schema.Struct({ id: Schema.String, name: Schema.String }),
});

/** The host's reading of its own metadata, as a Hub-backed app supplies it. */
function readAuthor(meta: SessionMessage["meta"]) {
  const decoded = Schema.decodeUnknownOption(AuthorMeta)(meta);
  return Option.isSome(decoded) ? decoded.value.author : undefined;
}

async function settle(operation?: () => void) {
  await act(async () => {
    operation?.();
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  });
}

it("updates the live tail without rehighlighting settled messages or rescanning history", async () => {
  // JSDOM has no layout; keep the real virtualizer's visible range measurable.
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(800);
  const highlight = vi.spyOn(highlighting, "highlightMarkdownCode");
  const snapshot = sessionSnapshot({
    messages: [
      {
        id: "settled",
        commandId: "first-command",
        sequence: 1,
        value: {
          role: "user",
          content: "```js\nconst settled = true;\n```",
          timestamp: 1,
        },
      },
    ],
    status: "thinking",
  });
  const historyIterations = vi.spyOn(snapshot.messages, Symbol.iterator);
  let receive: ((result: IteratorResult<SessionFrame>) => void) | undefined;
  const changes: AsyncIterable<SessionFrame> = {
    [Symbol.asyncIterator]: () => ({
      next: () =>
        new Promise((resolve) => {
          receive = resolve;
        }),
    }),
  };
  const session: ParakeetSession = {
    latestPending: () => Promise.resolve(null),
    withdraw: () => Promise.resolve({ status: "unknown" }),
    address: "test://parakeet/settled-rendering",
    command: commandHandler(commandResult),
    extension: noExtension,
    read: () => Promise.resolve(snapshot),
    watch: () =>
      Promise.resolve({
        snapshot,
        changes,
        close: () => {
          receive?.({ done: true, value: undefined });
          return Promise.resolve();
        },
      }),
  };
  const client = new QueryClient();
  clients.add(client);
  const { container, root } = mount();
  await settle(() => {
    root.render(
      <QueryClientProvider client={client}>
        <Parakeet session={session} />
      </QueryClientProvider>,
    );
  });
  await vi.waitFor(async () => {
    await settle();
    expect(container.textContent).toContain("const settled = true;");
  });
  const liveRegion = container.querySelector('[aria-live="polite"].sr-only');
  expect(liveRegion?.getAttribute("aria-atomic")).toBe("true");
  expect(
    container.querySelector("[data-chat-scroller]")?.hasAttribute("aria-live"),
  ).toBe(false);
  expect(liveRegion?.textContent).toBe("thinking");
  highlight.mockClear();
  historyIterations.mockClear();

  let textOffset = 0;
  for (const revision of [1, 2, 3]) {
    const append =
      revision === 1
        ? "**Live revision 1**\n\n```js\nconst live = 1;"
        : `\n// Live revision ${String(revision)}\nconst live = ${String(revision)};${revision === 3 ? "\n```" : ""}`;
    await settle(() => {
      if (receive === undefined) throw new Error("Session watch is not ready");
      receive({
        done: false,
        value: sessionFrame({
          kind: "progress",
          status: "streaming",
          progress: {
            messageId: "live",
            revision,
            text: {
              offset: textOffset,
              append,
            },
            thinking: { offset: 0, append: "" },
          },
        }),
      });
    });
    textOffset += append.length;
    await vi.waitFor(async () => {
      await settle();
      expect(container.textContent).toContain(
        `Live revision ${String(revision)}`,
      );
      expect(liveRegion?.textContent).toBe("writing");
      expect(liveRegion?.textContent).not.toContain("Live revision");
    });
  }

  expect({
    settledHighlightCalls: highlight.mock.calls.filter(([code]) =>
      code.includes("const settled = true;"),
    ).length,
    historyScans: historyIterations.mock.calls.length,
  }).toEqual({ settledHighlightCalls: 0, historyScans: 0 });

  expect(
    highlight.mock.calls
      .filter(([code]) => code.includes("const live ="))
      .map(([code]) => code.trim()),
  ).toEqual([
    "const live = 1;",
    "const live = 1;\n// Live revision 2\nconst live = 2;",
    "const live = 1;\n// Live revision 2\nconst live = 2;\n// Live revision 3\nconst live = 3;",
  ]);

  await settle(() => {
    if (receive === undefined) throw new Error("Session watch is not ready");
    receive({
      done: false,
      value: sessionFrame({
        kind: "update",
        delivery: "live",
        cursor: "second-command",
        messages: [
          {
            id: "changed",
            commandId: "second-command",
            sequence: 2,
            value: {
              role: "user",
              content: "```js\nconst changed = true;\n```",
              timestamp: 2,
            },
          },
        ],
        terminals: [{ commandId: "second-command", outcome: "failed" }],
        pending: { total: 0, prompts: [], hasMore: false },
        status: "idle",
      }),
    });
  });
  await vi.waitFor(async () => {
    await settle();
    expect(container.textContent).toContain("const changed = true;");
    expect(
      container.querySelector(".parakeet-composer-row")?.textContent,
    ).toContain("failed");
  });
  expect(container.textContent).not.toContain("Live revision 3");
  expect(liveRegion?.textContent).toBe("failed");
  expect(
    highlight.mock.calls.some(([code]) =>
      code.includes("const changed = true;"),
    ),
  ).toBe(true);
});

/** Owns view-only disclosure state the way ParakeetView does. */
function DisclosureHarness({ item }: { item: ParakeetTimelineRow }) {
  const [state, setState] = useState(initialToolDisclosure);
  return (
    <TimelineItem
      item={item}
      onToggleTool={(id, defaultOpen) => {
        setState((current) => toggleDisclosure(current, id, defaultOpen));
      }}
      toolDisclosure={state}
    />
  );
}

it("shows only the latest three finished rows, followed by the group expander", () => {
  const { container, root } = mount();
  const tools = Array.from({ length: 5 }, (_, index): ToolItem => ({
    id: `call-${String(index + 1)}`,
    kind: "tool",
    name: "read",
    args: { path: `file-${String(index + 1)}.txt` },
    status: "completed",
    startedAt: index * 1000,
    result: {
      role: "toolResult",
      toolCallId: `call-${String(index + 1)}`,
      toolName: "read",
      content: [{ type: "text", text: "contents" }],
      isError: false,
      timestamp: index * 1000 + 250,
    },
  }));
  const [first, ...rest] = tools;
  if (first === undefined) throw new Error("Missing tool fixture");
  act(() => {
    root.render(<DisclosureHarness item={toolGroup([first, ...rest])} />);
  });
  expect(container.textContent).toContain("Read 5 files · 5 calls");
  expect(container.textContent).not.toContain("file-1.txt");
  expect(
    [...container.querySelectorAll("[data-parakeet-call]")].map(
      (row) => row.textContent,
    ),
  ).toEqual([
    "Read file-3.txt250ms",
    "Read file-4.txt250ms",
    "Read file-5.txt250ms",
  ]);
  const buttons = [
    ...container.querySelectorAll<HTMLButtonElement>("button[aria-expanded]"),
  ];
  expect(buttons.at(-1)?.textContent).toBe("Show all 5 calls");
  expect(buttons.at(-1)?.getAttribute("aria-expanded")).toBe("false");
  expect(buttons.at(-1)?.querySelector("svg, .caps-status")).toBeNull();
  expect(buttons[0]?.textContent).toContain("Read 5 files · 5 calls4.3s");
});

it("expands the finished list and collapses it back from the trailing lead", () => {
  const { container, root } = mount();
  const tools = Array.from({ length: 5 }, (_, index): ToolItem => ({
    id: `call-${String(index + 1)}`,
    kind: "tool",
    name: "read",
    args: { path: `file-${String(index + 1)}.txt` },
    status: "completed",
    startedAt: index * 1000,
    result: {
      role: "toolResult",
      toolCallId: `call-${String(index + 1)}`,
      toolName: "read",
      content: [{ type: "text", text: "contents" }],
      isError: false,
      timestamp: index * 1000 + 250,
    },
  }));
  const [first, ...rest] = tools;
  if (first === undefined) throw new Error("Missing tool fixture");
  act(() => {
    root.render(<DisclosureHarness item={toolGroup([first, ...rest])} />);
  });
  const lead = () =>
    [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) =>
        button.textContent.includes("Show all 5 calls") ||
        button.textContent.includes("Show less"),
    );
  expect(lead()).toBeDefined();
  act(() => {
    lead()?.click();
  });
  expect(container.querySelectorAll("[data-parakeet-call]")).toHaveLength(5);
  expect(container.textContent).toContain("file-1.txt");
  expect(lead()?.textContent).toBe("Show less");
  expect(lead()?.getAttribute("aria-expanded")).toBe("true");
  expect(lead()).toBe(container.querySelectorAll("button").item(6));
  act(() => {
    lead()?.click();
  });
  expect(container.querySelectorAll("[data-parakeet-call]")).toHaveLength(3);
  expect(container.textContent).not.toContain("file-1.txt");
});

it.each([1, 2, 3])(
  "shows every row for %s finished calls without a group expander",
  (count) => {
    const { container, root } = mount();
    const tools = Array.from({ length: count }, (_, index): ToolItem => ({
      id: `call-${String(index + 1)}`,
      kind: "tool",
      name: "read",
      args: { path: `file-${String(index + 1)}.txt` },
      status: "completed",
      startedAt: index * 1000,
      result: {
        role: "toolResult",
        toolCallId: `call-${String(index + 1)}`,
        toolName: "read",
        content: [{ type: "text", text: "contents" }],
        isError: false,
        timestamp: index * 1000 + 250,
      },
    }));
    const [first, ...rest] = tools;
    if (first === undefined) throw new Error("Missing tool fixture");
    act(() => {
      root.render(<DisclosureHarness item={toolGroup([first, ...rest])} />);
    });
    expect(container.querySelectorAll("[data-parakeet-call]")).toHaveLength(
      count,
    );
    expect(container.textContent).not.toMatch(/Show all|Show less/u);
    if (count === 1) {
      expect(
        container.querySelectorAll(".caps-disclosure-trigger"),
      ).toHaveLength(1);
      expect(container.textContent).not.toContain("1 calls");
    } else {
      expect(container.textContent).toContain(`· ${String(count)} calls`);
    }
    expect(container.textContent).toContain("file-1.txt");
  },
);

it("keeps tool disclosure state interactive and renders changed tool results", () => {
  const { container, root } = mount();
  const item: ToolItem = {
    id: "tool",
    kind: "tool",
    name: "read",
    args: { path: "README.md" },
    status: "running",
  };
  act(() => {
    root.render(<DisclosureHarness item={toolGroup([item])} />);
  });
  const disclosure = container.querySelector<HTMLButtonElement>(
    "[data-parakeet-call] button[aria-expanded]",
  );
  if (disclosure === null) throw new Error("Tool disclosure is missing");
  act(() => {
    disclosure.click();
  });
  expect(disclosure.getAttribute("aria-expanded")).toBe("true");
  expect(container.textContent).toContain("README.md");

  act(() => {
    root.render(
      <DisclosureHarness
        item={toolGroup([
          {
            ...item,
            status: "completed",
            result: {
              role: "toolResult",
              toolCallId: "tool",
              toolName: "read",
              content: [{ type: "text", text: "New tool result" }],
              isError: false,
              timestamp: 2,
            },
          },
        ])}
      />,
    );
  });
  expect(disclosure.getAttribute("aria-expanded")).toBe("true");
  expect(
    container
      .querySelector("[data-parakeet-call]")
      ?.getAttribute("data-status"),
  ).toBe("completed");
  expect(container.textContent).toContain("New tool result");
  act(() => {
    disclosure.click();
  });
  expect(disclosure.getAttribute("aria-expanded")).toBe("false");
  expect(container.textContent).not.toContain("New tool result");
});

it("offers host tool actions only for completed successful results and preserves external links", async () => {
  const { container, root } = mount();
  const item: ToolItem = {
    id: "file",
    kind: "tool",
    name: "execute",
    args: {},
    status: "running",
    result: {
      role: "toolResult",
      toolCallId: "file",
      toolName: "execute",
      content: [{ type: "text", text: "{}" }],
      timestamp: 1,
      isError: false,
    },
  };
  const actions = vi.fn(() => <button type="button">Open file</button>);
  await settle(() => {
    root.render(
      <TimelineItem item={toolGroup([item])} renderToolActions={actions} />,
    );
  });
  expect(actions).not.toHaveBeenCalled();
  await settle(() => {
    root.render(
      <TimelineItem
        item={toolGroup([{ ...item, status: "completed" }])}
        renderToolActions={actions}
      />,
    );
  });
  expect(container.textContent).toContain("Open file");
  await settle(() => {
    root.render(
      <TimelineItem
        item={toolGroup([{ ...item, status: "error" }])}
        renderToolActions={actions}
      />,
    );
  });
  expect(container.textContent).not.toContain("Open file");
  await settle(() => {
    root.render(
      <TimelineItem
        item={{
          id: "external",
          kind: "assistant_message",
          text: "[Documentation](https://example.com/docs)",
          pending: false,
        }}
        renderToolActions={actions}
      />,
    );
  });
  const link = container.querySelector("a");
  expect(link?.getAttribute("href")).toBe("https://example.com/docs");
  expect(link?.getAttribute("target")).toBe("_blank");
  expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
});

it("hides a tool body's image parts only for results the host claims", async () => {
  const { container, root } = mount();
  const item: ToolItem = {
    id: "picture",
    kind: "tool",
    name: "execute",
    args: {},
    status: "completed",
    result: {
      role: "toolResult",
      toolCallId: "picture",
      toolName: "execute",
      content: [
        { type: "text", text: "{}" },
        { type: "image", data: "AQID", mimeType: "image/png" },
      ],
      timestamp: 1,
      isError: false,
    },
  };
  const expanded = toggleDisclosure(initialToolDisclosure, item.id, false);
  const render = (claims?: (tool: ToolItem) => boolean) =>
    settle(() => {
      root.render(
        <TimelineItem
          item={toolGroup([item])}
          toolDisclosure={expanded}
          {...(claims === undefined ? {} : { claimsToolMedia: claims })}
        />,
      );
    });
  await render();
  expect(container.querySelectorAll("img")).toHaveLength(1);
  await render(() => false);
  expect(container.querySelectorAll("img")).toHaveLength(1);
  const claims = vi.fn(() => true);
  await render(claims);
  expect(claims).toHaveBeenCalledWith(
    expect.objectContaining({ id: "picture" }),
  );
  expect(container.querySelectorAll("img")).toHaveLength(0);
});

it("adds caller attachments only to settled successful assistant replies", async () => {
  const { container, root } = mount();
  const renderAssistantAttachment = vi.fn((text: string) => (
    <aside>Attachment for {text}</aside>
  ));
  const item = {
    id: "reply",
    kind: "assistant_message" as const,
    text: "Share: https://example.com/frog",
    pending: true,
  };
  await settle(() => {
    root.render(
      <TimelineItem
        item={item}
        renderAssistantAttachment={renderAssistantAttachment}
      />,
    );
  });
  expect(renderAssistantAttachment).not.toHaveBeenCalled();
  await settle(() => {
    root.render(
      <TimelineItem
        item={{ ...item, pending: false, isError: true }}
        renderAssistantAttachment={renderAssistantAttachment}
      />,
    );
  });
  expect(renderAssistantAttachment).not.toHaveBeenCalled();
  await settle(() => {
    root.render(
      <TimelineItem
        item={{ ...item, pending: false }}
        renderAssistantAttachment={renderAssistantAttachment}
      />,
    );
  });
  expect(container.textContent).toContain("Attachment for Share:");
});

it("keeps provider text only in existing details without markdown interpretation", async () => {
  const { container, root } = mount();
  const privateText = "provider_error: 401 Bearer sk-live-private\nretry later";
  await settle(() => {
    root.render(
      <TimelineItem
        item={{
          id: "failed-turn",
          kind: "assistant_message",
          isError: true,
          pending: false,
          text: "This run couldn’t finish.",
          providerError: privateText,
        }}
      />,
    );
  });
  const bubble = container.querySelector('[data-provider-error="failed-turn"]');
  expect(bubble?.querySelector("p")).toBeNull();
  expect(bubble?.querySelector("details")?.open).toBe(false);
  expect(bubble?.querySelector("details pre")?.textContent).toBe(privateText);
  expect(bubble?.querySelector("a")).toBeNull();
});

it("formats only the visible assistant text and preserves the attachment input", async () => {
  const { container, root } = mount();
  const attachment = vi.fn((text: string) => <aside>{text}</aside>);
  await settle(() => {
    root.render(
      <TimelineItem
        item={{
          id: "reply",
          kind: "assistant_message",
          text: "Made a game.\nShare: https://example.com/frog",
          pending: false,
        }}
        formatAssistantText={(text) => text.split("\n")[0] ?? ""}
        renderAssistantAttachment={attachment}
      />,
    );
  });
  expect(container.querySelector(".text-base-content")?.textContent).toBe(
    "Made a game.",
  );
  expect(attachment).toHaveBeenCalledWith(
    "Made a game.\nShare: https://example.com/frog",
  );
});

it("draws edit diffs from the headless rows, with no result envelope", () => {
  const { container, root } = mount();
  const tool: ToolItem = {
    id: "patch",
    kind: "tool",
    name: "apply_patch",
    args: {
      patch: [
        "*** Begin Patch",
        "*** Update File: src/a.ts",
        "@@ function main",
        " keep();",
        "-old();",
        "+next();",
        "*** End Patch",
      ].join("\n"),
    },
    status: "completed",
    result: {
      role: "toolResult",
      toolCallId: "patch",
      toolName: "apply_patch",
      content: [
        {
          type: "text",
          text: JSON.stringify({
            status: "completed",
            exitCode: 0,
            stdout: "Success.",
            stderr: "",
            truncated: false,
          }),
        },
      ],
      isError: false,
      timestamp: 2,
    },
  };
  const group = toolGroup([tool]);
  act(() => {
    root.render(<DisclosureHarness item={group} />);
  });
  const header = container.querySelector<HTMLButtonElement>(
    "[data-parakeet-call] button[aria-expanded]",
  );
  expect(header?.textContent).toContain("Updated src/a.ts");
  act(() => {
    header?.click();
  });
  const [section] = group.calls[0]?.sections ?? [];
  if (section?.kind !== "diff") throw new Error("expected a diff");
  const drawn = [...container.querySelectorAll(".caps-diff-line")].map(
    (line) => ({
      kind: line.getAttribute("data-kind"),
      text: line.textContent.replace(/^(\+|-|@@| )/u, "").replace(/\n$/u, ""),
    }),
  );
  expect(drawn).toEqual(section.lines);
  expect(container.textContent).not.toMatch(/Success|truncated|RESULT/iu);
});

it("keeps admission diagnostics out of the chat and preserves dismissal", async () => {
  const { container, root } = mount();
  const dismiss = vi.fn();
  await settle(() => {
    root.render(
      <TimelineItem
        item={{
          id: "failed-prompt",
          kind: "user_message",
          text: "Try this",
          status: "failed",
          requestId: "request-1",
          error: "admission diagnostic fixture",
        }}
        onDismissFailed={dismiss}
      />,
    );
  });
  expect(container.textContent).toContain(
    "Your prompt didn’t make it through.",
  );
  expect(container.textContent).not.toContain("admission diagnostic fixture");
  await settle(() =>
    container.querySelector<HTMLButtonElement>("button")?.click(),
  );
  expect(dismiss).toHaveBeenCalledWith("request-1");
});

it("words a failed Agent message for an Agent, not as the human's prompt", async () => {
  const { container, root } = mount();
  await settle(() => {
    root.render(
      <TimelineItem
        item={{
          id: "failed-agent-message",
          kind: "user_message",
          text: "From the other Agent",
          status: "failed",
          requestId: "request-2",
          author: { id: "agent_a", name: "Research agent", kind: "agent" },
        }}
        onDismissFailed={vi.fn()}
      />,
    );
  });
  expect(container.textContent).toContain(
    "That Agent message didn’t make it through.",
  );
  expect(container.textContent).not.toContain("Your prompt");
});

it("updates settled host output when renderer dependencies change", () => {
  const { container, root } = mount();
  const item: ParakeetTimelineRow = {
    id: "host-rendering",
    kind: "assistant_message",
    text: "Reply",
    pending: false,
  };
  const render = (prefix: string) => {
    act(() => {
      root.render(
        <TimelineItem
          item={item}
          formatAssistantText={(text) => `${prefix}: ${text}`}
          renderAssistantAttachment={(text) => (
            <aside>
              {prefix} attachment: {text}
            </aside>
          )}
        />,
      );
    });
  };
  render("First");
  expect(container.textContent).toContain("First: Reply");
  render("Second");
  expect(container.textContent).toContain("Second: Reply");
  expect(container.querySelector("aside")?.textContent).toBe(
    "Second attachment: Reply",
  );
  expect(container.textContent).not.toContain("First");
});

it("shows the admitted key name on the simple user rail without an avatar", async () => {
  const { container, root } = mount();
  await settle(() => {
    root.render(
      <TimelineItem
        item={{
          id: "key-command",
          kind: "user_message",
          status: "confirmed",
          text: "Inspect the project",
          author: { id: "team-key:key-a", name: "Zed local project" },
        }}
      />,
    );
  });
  expect(
    container.querySelector('[data-author="team-key:key-a"]')?.textContent,
  ).toBe("Zed local project");
  expect(container.textContent).toContain("Inspect the project");
  expect(container.querySelector("img")).toBeNull();
});

const agentReply: ParakeetTimelineRow = {
  id: "agent-reply",
  kind: "user_message",
  status: "confirmed",
  text: "Findings: three kilns ready",
  author: { id: "agent_research", name: "Research agent", kind: "agent" },
};

it("starts another Agent's message collapsed as one line: sigil, name, preview (Levi: should start collapsed)", () => {
  const { container, root } = mount();
  act(() => {
    root.render(<DisclosureHarness item={agentReply} />);
  });
  const block = container.querySelector("[data-agent-message]");
  const toggle = block?.querySelector("button");
  expect(toggle?.getAttribute("aria-expanded")).toBe("false");
  expect(toggle?.querySelector('[data-sigil="agent"]')).not.toBeNull();
  expect(toggle?.textContent).toBe(
    "Research agent· Findings: three kilns ready",
  );
  expect(block?.children).toHaveLength(1);
  expect(container.textContent).not.toContain("↳");
  expect(container.querySelector('[data-speaker="user"]')).toBeNull();
  expect(container.querySelector("img")).toBeNull();
});

it("expands another Agent's message to the full block and collapses it back (Levi: and be expandable)", () => {
  const { container, root } = mount();
  act(() => {
    root.render(<DisclosureHarness item={agentReply} />);
  });
  const toggle = () =>
    container.querySelector<HTMLButtonElement>("[data-agent-message] button");
  act(() => {
    toggle()?.click();
  });
  const block = container.querySelector("[data-agent-message]");
  expect(toggle()?.getAttribute("aria-expanded")).toBe("true");
  expect(toggle()?.textContent).toBe("Research agent");
  expect(block?.children[1]?.textContent).toBe("Findings: three kilns ready");
  expect(container.textContent).not.toContain("↳");
  act(() => {
    toggle()?.click();
  });
  expect(toggle()?.getAttribute("aria-expanded")).toBe("false");
  expect(
    container.querySelector("[data-agent-message]")?.children,
  ).toHaveLength(1);
});

it("keeps a human-authored line as the user bubble (human lines unchanged)", async () => {
  const { container, root } = mount();
  await settle(() => {
    root.render(
      <TimelineItem
        item={{
          id: "human-line",
          kind: "user_message",
          status: "confirmed",
          text: "↳ Research agent replied: done",
          author: { id: "visitor_ada", name: "Ada" },
        }}
      />,
    );
  });
  expect(container.querySelector('[data-speaker="user"]')).not.toBeNull();
  expect(container.querySelector("[data-agent-message]")).toBeNull();
});

it("shows a single tool call once and expands that call directly", () => {
  const { container, root } = mount();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.add(client);
  const tool: ToolItem = {
    id: "single-read",
    kind: "tool",
    name: "read",
    args: { path: "check.txt" },
    status: "completed",
    startedAt: 0,
    result: {
      role: "toolResult",
      toolCallId: "single-read",
      toolName: "read",
      content: [{ type: "text", text: "Passed" }],
      isError: false,
      timestamp: 250,
    },
  };
  act(() => {
    root.render(
      <QueryClientProvider client={client}>
        <DisclosureHarness item={toolGroup([tool])} />
      </QueryClientProvider>,
    );
  });
  expect(container.querySelectorAll(".caps-disclosure-trigger")).toHaveLength(
    1,
  );
  expect(container.textContent.match(/Read check\.txt/gu)).toHaveLength(1);
  expect(container.textContent).not.toContain("1 calls");
  expect(container.textContent).not.toContain("Show all");
  const lead = container.querySelector<HTMLButtonElement>(
    "button[aria-expanded]",
  );
  expect(lead?.getAttribute("aria-expanded")).toBe("false");
  act(() => lead?.click());
  expect(lead?.getAttribute("aria-expanded")).toBe("true");
  expect(container.textContent).toContain("Passed");
  expect(container.querySelectorAll(".caps-disclosure-trigger")).toHaveLength(
    1,
  );
  const second: ToolItem = {
    ...tool,
    id: "second-read",
    args: { path: "other.txt" },
    result: {
      role: "toolResult",
      toolCallId: "second-read",
      toolName: "read",
      content: [{ type: "text", text: "Other contents" }],
      isError: false,
      timestamp: 300,
    },
  };
  act(() => {
    root.render(
      <QueryClientProvider client={client}>
        <DisclosureHarness item={toolGroup([tool, second])} />
      </QueryClientProvider>,
    );
  });
  expect(container.textContent).toContain("Read 2 files · 2 calls");
  expect(
    container
      .querySelector("[data-parakeet-call] button[aria-expanded]")
      ?.getAttribute("aria-expanded"),
  ).toBe("true");
  expect(container.textContent).toContain("Passed");
});

it("labels each compaction notice result, stale and insufficient as skipped", () => {
  const { container, root } = mount();
  const labels = (
    ["nothing_to_compact", "failed", "stale", "insufficient"] as const
  ).map((result) => {
    act(() => {
      root.render(
        <TimelineItem
          item={{
            id: `notice-${result}`,
            kind: "compaction_notice",
            at: 1,
            trigger: "threshold",
            result,
            diagnostic: null,
          }}
        />,
      );
    });
    return container.textContent;
  });
  expect(labels).toEqual([
    "· nothing to compact",
    "· compaction failed",
    "· compaction skipped: the context moved on",
    "· compaction skipped: the summary would not fit",
  ]);
});
