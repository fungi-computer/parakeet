// @vitest-environment jsdom
import type {
  PromptCommand,
  SessionCommand,
  SessionFrame,
  SessionSnapshot,
} from "@fungi.computer/shiitake/client";
import { createWhistle, type WhistleRuntime } from "@fungi.computer/whistle";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import { ParakeetProvider } from "../src/headless.js";
import { ParakeetView } from "../src/parakeet.js";
import { MarkdownRenderer } from "../src/components/MarkdownRenderer.js";
import type { ParakeetSession } from "../src/session.js";
import * as Schema from "effect/Schema";
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

afterEach(async () => {
  await act(async () => {
    for (const root of roots) root.unmount();
    await Promise.resolve();
  });
  roots.clear();
  document.body.replaceChildren();
});

type Frames = Readonly<{
  iterable: AsyncIterable<SessionFrame>;
  push: (frame: SessionFrame) => void;
}>;

function frames(): Frames {
  const queued: SessionFrame[] = [];
  const waiting: ((result: IteratorResult<SessionFrame>) => void)[] = [];
  return {
    iterable: {
      [Symbol.asyncIterator]: () => ({
        next: () => {
          const frame = queued.shift();
          if (frame !== undefined)
            return Promise.resolve({ done: false, value: frame });
          return new Promise((resolve) => {
            waiting.push(resolve);
          });
        },
        return: () => Promise.resolve({ done: true, value: undefined }),
      }),
    },
    push: (frame) => {
      const resolve = waiting.shift();
      if (resolve === undefined) queued.push(frame);
      else resolve({ done: false, value: frame });
    },
  };
}

function hostSession(
  snapshot: SessionSnapshot,
  changes: Frames,
  commands: SessionCommand[],
): ParakeetSession {
  return {
    latestPending: () => Promise.resolve(null),
    withdraw: () => Promise.resolve({ status: "unknown" }),
    address: `test://parakeet/host/${String(roots.size)}`,
    command: commandHandler(
      (input) => {
        commands.push(input);
        return commandResult(input);
      },
      (input) => {
        commands.push(input);
        return commandResult(input);
      },
      (input) => {
        commands.push(input);
        return commandResult(input);
      },
    ),
    extension: noExtension,
    read: () => Promise.resolve(snapshot),
    watch: () =>
      Promise.resolve({
        snapshot,
        changes: changes.iterable,
        close: () => Promise.resolve(),
      }),
  };
}

/** The demo host's shape: every composer submission goes through Whistle. */
function HostView({
  commands,
  onLink,
}: Readonly<{
  commands: WhistleRuntime;
  onLink?: ((href: string) => boolean) | undefined;
}>): ReactElement {
  return (
    <ParakeetView
      commands={commands}
      onLink={onLink}
      empty={
        onLink ? (
          <MarkdownRenderer>
            {
              "[Billing](https://hub.example.com/teams/zero/billing#team-billing) [Ordinary](https://example.com/)"
            }
          </MarkdownRenderer>
        ) : undefined
      }
    />
  );
}

function render(
  session: ParakeetSession,
  commands: WhistleRuntime,
  onLink?: (href: string) => boolean,
) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.add(root);
  act(() => {
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <ParakeetProvider session={session}>
          <HostView commands={commands} onLink={onLink} />
        </ParakeetProvider>
      </QueryClientProvider>,
    );
  });
  return container;
}

it("lets the host handle a transcript link before sandbox popup navigation", async () => {
  const onLink = vi.fn((href: string) => href.endsWith("#team-billing"));
  const container = render(
    hostSession(sessionSnapshot(), frames(), []),
    createWhistle(),
    onLink,
  );
  await settle();
  const billing = container.querySelector<HTMLAnchorElement>(
    'a[href$="#team-billing"]',
  );
  if (!billing) throw new Error("Missing Billing link");
  const child = document.createElement("span");
  child.textContent = "Billing";
  billing.replaceChildren(child);
  const handled = new MouseEvent("click", { bubbles: true, cancelable: true });
  child.dispatchEvent(handled);
  expect(onLink).toHaveBeenCalledWith(billing.href);
  expect(handled.defaultPrevented).toBe(true);
  const ordinary = container.querySelector<HTMLAnchorElement>(
    'a[href="https://example.com/"]',
  );
  if (!ordinary) throw new Error("Missing ordinary link");
  let prevented = true;
  ordinary.addEventListener("click", (event) => {
    prevented = event.defaultPrevented;
    event.preventDefault(); // Keep jsdom from attempting an actual navigation.
  });
  ordinary.dispatchEvent(
    new MouseEvent("click", { bubbles: true, cancelable: true }),
  );
  expect(prevented).toBe(false);
});

async function settle(operation?: () => void): Promise<void> {
  await act(async () => {
    operation?.();
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  });
}

function textarea(container: HTMLElement): HTMLTextAreaElement {
  const element = container.querySelector("textarea");
  if (!(element instanceof HTMLTextAreaElement))
    throw new Error("Composer textarea is unavailable");
  return element;
}

function type(element: HTMLTextAreaElement, value: string): void {
  Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )?.set?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

function enter(element: HTMLTextAreaElement): void {
  element.dispatchEvent(
    new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Enter",
    }),
  );
}

function prompts(commands: readonly SessionCommand[]): PromptCommand[] {
  return commands.filter(
    (command): command is PromptCommand => command.type === "prompt",
  );
}

it("dispatches a slash command typed during an active run through the host", async () => {
  const runtime = createWhistle();
  const executed: string[] = [];
  runtime.contribute({
    sourceId: "model-test",
    namespace: "model-test",
    commands: [
      {
        id: "model",
        title: "Choose a model",
        category: "Model",
        projections: { slash: { aliases: ["model"] } },
        handler: () => {
          executed.push("model");
        },
      },
    ],
  });
  const commands: SessionCommand[] = [];
  const container = render(
    hostSession(sessionSnapshot({ status: "streaming" }), frames(), commands),
    runtime,
  );
  await vi.waitFor(async () => {
    await settle();
    expect(
      container.querySelector('[aria-label="Stop current turn"]'),
    ).not.toBeNull();
  });

  const input = textarea(container);
  await settle(() => {
    type(input, "/model");
  });
  await settle(() => {
    enter(input);
  });
  expect(executed).toEqual(["model"]);
  expect(input.value).toBe("");

  // With a draft, the running composer's one key does what Enter does.
  await settle(() => {
    type(input, "/model");
  });
  expect(
    container.querySelector('[aria-label="Stop current turn"]'),
  ).toBeNull();
  await settle(() => {
    container
      .querySelector<HTMLButtonElement>('[aria-label="Queue follow-up"]')
      ?.click();
  });
  expect(executed).toEqual(["model", "model"]);
  expect(prompts(commands)).toEqual([]);

  await settle(() => {
    type(input, "Afterwards, tidy up");
  });
  await settle(() => {
    enter(input);
  });
  expect(prompts(commands)).toMatchObject([
    { text: "Afterwards, tidy up", delivery: "followUp" },
  ]);
});

it("shows Stop while the owner reports work after a completed prompt", async () => {
  const changes = frames();
  const commands: SessionCommand[] = [];
  const completedPrompt = sessionSnapshot({
    messages: [
      {
        id: "user-1",
        commandId: "command-1",
        sequence: 1,
        value: { role: "user", content: "Pursue the goal", timestamp: 1 },
      },
    ],
    terminals: [{ commandId: "command-1", outcome: "completed" }],
    status: "idle",
  });
  const container = render(
    hostSession(completedPrompt, changes, commands),
    createWhistle(),
  );
  await settle();
  expect(
    container.querySelector('[aria-label="Stop current turn"]'),
  ).toBeNull();

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
  await vi.waitFor(async () => {
    await settle();
    expect(
      container.querySelector('[aria-label="Stop current turn"]'),
    ).not.toBeNull();
  });
  await settle(() => {
    container
      .querySelector<HTMLButtonElement>('[aria-label="Stop current turn"]')
      ?.click();
  });
  expect(commands).toEqual([{ type: "cancel", commandId: "running-command" }]);
});

it("clears a slash draft only when its command handled that unedited draft", async () => {
  const runtime = createWhistle();
  const planted: string[] = [];
  const confirmations: string[] = [];
  const catalog = {
    protocol: "whistle.catalog/v1",
    commands: [
      {
        id: "plant",
        title: "Plant something",
        category: "Garden",
        projections: {
          slash: {
            aliases: ["plant"],
            arguments: {
              hint: "<what>",
              text: { field: "what", arguments: {} },
            },
          },
        },
      },
    ],
  };
  const extension: ParakeetSession["extension"] = () => ({
    call: (_command, input) => {
      const request = Schema.decodeUnknownSync(
        Schema.Struct({
          what: Schema.String,
          confirmed: Schema.optional(Schema.Boolean),
        }),
      )(input);
      if (request.confirmed === undefined) {
        confirmations.push(request.what);
        return Promise.resolve({
          type: "prompt",
          prompt: {
            type: "confirmation",
            message: `Replace the bed with ${request.what}?`,
            confirmLabel: "Replace",
            cancelLabel: "Keep",
          },
          next: { arguments: { what: request.what }, answer: "confirmed" },
        });
      }
      if (!request.confirmed)
        return Promise.resolve({ type: "done", result: { cancelled: true } });
      planted.push(request.what);
      return Promise.resolve({ type: "done" });
    },
  });
  const container = render(
    {
      ...hostSession(
        sessionSnapshot({
          extensions: {
            garden: {
              status: "running",
              revision: "sha256:garden",
              value: null,
              catalog,
            },
          },
        }),
        frames(),
        [],
      ),
      extension,
    },
    runtime,
  );
  await vi.waitFor(async () => {
    await settle();
    expect(runtime.snapshot().slash.map((row) => row.alias)).toContain("plant");
  });
  const input = textarea(container);
  const answer = async (label: "Replace" | "Keep") => {
    await vi.waitFor(async () => {
      await settle();
      expect(button(label)).not.toBeNull();
    });
    await settle(() => {
      button(label)?.click();
    });
    await settle();
  };

  // A declined replacement is handled, but it keeps the human's text.
  await settle(() => {
    type(input, "/plant moss");
  });
  await settle(() => {
    enter(input);
  });
  await answer("Keep");
  expect(planted).toEqual([]);
  expect(input.value).toBe("/plant moss");

  // An accepted replacement clears exactly the submitted draft.
  await settle(() => {
    enter(input);
  });
  await answer("Replace");
  expect(planted).toEqual(["moss"]);
  expect(input.value).toBe("");

  // An edit while the command runs survives its completion.
  await settle(() => {
    type(input, "/plant fern");
  });
  await settle(() => {
    enter(input);
  });
  await vi.waitFor(async () => {
    await settle();
    expect(button("Replace")).not.toBeNull();
  });
  await settle(() => {
    type(input, "/plant fern, edited");
  });
  await answer("Replace");
  expect(planted).toEqual(["moss", "fern"]);
  expect(input.value).toBe("/plant fern, edited");
  expect(confirmations).toEqual(["moss", "moss", "fern"]);
});

function button(label: string): HTMLButtonElement | null {
  return (
    [...document.body.querySelectorAll("button")].find(
      (candidate) => candidate.textContent === label,
    ) ?? null
  );
}

it("consumes a flagged command on failure and /keys while its dialog is open", async () => {
  const runtime = createWhistle();
  runtime.contribute({
    sourceId: "test",
    namespace: "test",
    commands: [
      {
        id: "thinking",
        title: "Thinking",
        category: "Settings",
        projections: { slash: { aliases: ["inspect"], consumesDraft: true } },
        handler: () => {
          throw new Error("Choose a model first.");
        },
      },
      {
        id: "keyed",
        title: "Keyed",
        category: "Advanced",
        projections: { bindings: { values: ["Ctrl+X"] } },
        handler: () => undefined,
      },
    ],
  });
  const container = render(
    hostSession(sessionSnapshot(), frames(), []),
    runtime,
  );
  const input = textarea(container);
  for (const draft of ["/inspect", "/inspect ", "/keys"]) {
    await settle(() => {
      type(input, draft);
    });
    await settle(() => {
      enter(input);
    });
    await vi.waitFor(async () => {
      await settle();
      expect(input.value).toBe("");
    });
  }
  expect(document.body.textContent).toContain("Key bindings");
});
