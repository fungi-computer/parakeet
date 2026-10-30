// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import * as Schema from "effect/Schema";
import { defineClientEntry } from "@fungi.computer/shiitake/client-entry";
import { ExtensionId, type Json } from "@fungi.computer/shiitake/extensions";
import type {
  SessionFrame,
  SessionExtensionSlots,
} from "@fungi.computer/shiitake/client";
import { Parakeet } from "../src/parakeet.js";
import type { ParakeetSession } from "../src/session.js";
import {
  commandHandler,
  commandResult,
  sessionFrame,
  sessionSnapshot,
} from "./fixtures/session.fixture.js";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});

const entry = defineClientEntry(
  {
    id: ExtensionId.make("question-proof"),
    commands: {},
    projection: { schema: Schema.String },
  },
  {
    contribute: (view) =>
      view.status !== "running" || view.value === null
        ? {
            chips: [],
            panel: [],
            timeline: { cells: [], omitted: 0 },
            waiting: null,
          }
        : {
            chips: [],
            panel: [
              {
                id: "ask-1",
                title: "Which color should we use?",
                detail: "Blue · Green",
                tone: "attention",
                actions: [
                  {
                    id: "answerFlow",
                    label: "Answer",
                    input: { askId: "ask-1" },
                    awaiting: "question",
                  },
                ],
              },
            ],
            timeline: { cells: [], omitted: 0 },
            waiting: null,
          },
  },
);

const slots = (asking: boolean): SessionExtensionSlots => ({
  "question-proof": {
    status: "running",
    revision: `sha256:${asking ? "asking" : "quiet"}`,
    value: asking ? "ask-1" : null,
    catalog: {
      protocol: "whistle.catalog/v1",
      commands: [
        {
          id: "answerFlow",
          title: "Answer a question",
          category: "Conversation",
        },
      ],
    },
  },
});

const answers = Schema.is(Schema.Struct({ stage: Schema.Literal("decision") }));

const decision: Json = {
  type: "prompt",
  prompt: {
    type: "decision",
    message: "Which color should we use?",
    options: [
      { value: "Blue", label: "Blue", description: "Use the blue theme" },
      { value: "Green", label: "Green", description: "Use the green theme" },
    ],
    other: { label: "Other…", maxLength: 100 },
  },
  next: {
    arguments: {
      stage: "decision",
      askId: "ask-1",
      requestId: "request-1",
      index: 0,
      answers: {},
    },
    answer: "answer",
  },
};

let sessionNumber = 0;

async function mount(asking: boolean) {
  const pending: SessionFrame[] = [];
  let deliver: ((value: IteratorResult<SessionFrame>) => void) | undefined;
  const changes: AsyncIterable<SessionFrame> = {
    [Symbol.asyncIterator]: () => ({
      next: () => {
        const value = pending.shift();
        return value === undefined
          ? new Promise((resolve) => {
              deliver = resolve;
            })
          : Promise.resolve({ done: false, value });
      },
      return: () => {
        deliver?.({ done: true, value: undefined });
        return Promise.resolve({ done: true, value: undefined });
      },
    }),
  };
  const push = (extensions: SessionExtensionSlots) => {
    const frame = sessionFrame({
      kind: "update",
      delivery: "live",
      cursor: null,
      messages: [],
      terminals: [],
      status: "idle",
      pending: { total: 0, prompts: [], hasMore: false },
      extensions,
    });
    if (deliver === undefined) pending.push(frame);
    else {
      const resolve = deliver;
      deliver = undefined;
      resolve({ done: false, value: frame });
    }
  };
  const snapshot = sessionSnapshot({ extensions: slots(asking) });
  const call = vi.fn((_command: string, args: Json): Promise<Json> =>
    Promise.resolve(
      answers(args)
        ? { type: "done", notice: { type: "success", message: "Answer sent." } }
        : decision,
    ),
  );
  const session: ParakeetSession = {
    latestPending: () => Promise.resolve(null),
    withdraw: () => Promise.resolve({ status: "unknown" }),
    address: `test://composer-question/${String(sessionNumber++)}`,
    command: commandHandler(commandResult),
    extension: () => ({ call }),
    read: () => Promise.resolve(snapshot),
    watch: () =>
      Promise.resolve({
        snapshot,
        changes,
        close: () => Promise.resolve(),
      }),
  };
  const query = new QueryClient();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const settle = async (operation?: () => void) =>
    act(async () => {
      operation?.();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
  await settle(() => {
    root.render(
      <QueryClientProvider client={query}>
        <Parakeet session={session} clients={[entry]} />
      </QueryClientProvider>,
    );
  });
  await settle();
  const group = () =>
    container.querySelector<HTMLElement>('[role="group"][data-kind]');
  const textarea = () => {
    const found = container.querySelector("textarea");
    if (found === null) throw new Error("Missing composer");
    return found;
  };
  const type = async (text: string) =>
    settle(() => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set?.call(textarea(), text);
      textarea().dispatchEvent(new Event("input", { bubbles: true }));
    });
  const key = async (name: string) =>
    settle(() => {
      const target = container.querySelector('[role="listbox"]');
      if (target === null) throw new Error("Missing list");
      target.dispatchEvent(
        new KeyboardEvent("keydown", { key: name, bubbles: true }),
      );
    });
  const button = (label: string) => {
    // A decision's footer row is one button whose key names the action.
    const found = [...container.querySelectorAll("button")].find(
      (value) =>
        value.textContent === label ||
        value.querySelector("[data-client-row-action]")?.textContent === label,
    );
    if (found === undefined) throw new Error(`Missing button ${label}`);
    return found;
  };
  return {
    container,
    settle,
    push,
    call,
    group,
    textarea,
    type,
    key,
    button,
    close: async () => {
      await settle(() => {
        root.unmount();
      });
      query.clear();
      container.remove();
    },
  };
}

it("a question takes over an empty composer, numbers only move, and Enter answers", async () => {
  const page = await mount(true);
  try {
    await vi.waitFor(async () => {
      await page.settle();
      expect(page.group()).not.toBeNull();
    });
    const group = page.group();
    expect(group?.getAttribute("aria-label")).toBe("Agent question 1 of 1");
    expect(page.textarea().closest("[hidden]")).not.toBeNull();
    expect(group?.textContent).toContain("1. Blue (recommended)");
    await page.key("2");
    expect(page.call.mock.calls.some(([, args]) => answers(args))).toBe(false);
    expect(
      page.container.querySelector("[data-highlight]")?.textContent,
    ).toContain("2. Green");
    await page.key("Enter");
    await vi.waitFor(async () => {
      await page.settle();
      expect(page.call).toHaveBeenCalledWith(
        "answerFlow",
        expect.objectContaining({
          stage: "decision",
          answer: { selected: ["Green"] },
        }),
      );
    });
    await vi.waitFor(async () => {
      await page.settle();
      expect(page.group()).toBeNull();
    });
    expect(page.textarea().closest("[hidden]")).toBeNull();
  } finally {
    await page.close();
  }
});

it("a question does not take over a non-empty draft", async () => {
  const page = await mount(false);
  try {
    await page.type("half a thought");
    await page.settle(() => {
      page.push(slots(true));
    });
    await vi.waitFor(async () => {
      await page.settle();
      expect(page.container.textContent).toContain(
        "Which color should we use?",
      );
    });
    expect(page.group()).toBeNull();
    expect(page.textarea().value).toBe("half a thought");
    // Answer in the footer row is the person asking for it.
    await page.settle(() => {
      page.button("Answer").click();
    });
    await vi.waitFor(async () => {
      await page.settle();
      expect(page.group()).not.toBeNull();
    });
    expect(page.textarea().value).toBe("half a thought");
  } finally {
    await page.close();
  }
});

it("Later is a neutral key that postpones without answering", async () => {
  const page = await mount(true);
  try {
    await vi.waitFor(async () => {
      await page.settle();
      expect(page.group()).not.toBeNull();
    });
    const later = page.button("Later");
    expect(later.tagName).toBe("BUTTON");
    expect(later.type).toBe("button");
    expect(later.getAttribute("data-tone")).toBe("neutral");
    await page.settle(() => {
      later.click();
    });
    expect(page.group()).toBeNull();
    expect(page.textarea().closest("[hidden]")).toBeNull();
    expect(page.call.mock.calls.some(([, args]) => answers(args))).toBe(false);
    expect(page.container.textContent).toContain("Which color should we use?");
  } finally {
    await page.close();
  }
});

it("draft returns after Esc", async () => {
  const page = await mount(false);
  try {
    await page.type("keep this");
    await page.settle(() => {
      page.push(slots(true));
    });
    await vi.waitFor(async () => {
      await page.settle();
      expect(page.container.textContent).toContain(
        "Which color should we use?",
      );
    });
    await page.settle(() => {
      page.button("Answer").click();
    });
    await vi.waitFor(async () => {
      await page.settle();
      expect(page.group()).not.toBeNull();
    });
    await page.key("Escape");
    expect(page.group()).toBeNull();
    expect(page.textarea().value).toBe("keep this");
    expect(page.textarea().closest("[hidden]")).toBeNull();
    // Later never answers.
    expect(page.call.mock.calls.some(([, args]) => answers(args))).toBe(false);
    expect(page.container.textContent).toContain("Which color should we use?");
  } finally {
    await page.close();
  }
});
