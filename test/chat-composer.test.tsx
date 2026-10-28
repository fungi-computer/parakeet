// @vitest-environment jsdom
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import { createParakeetInteractions } from "../src/commands/interactions.js";
import type { SlashCommandController } from "../src/commands/use-slash-commands.js";
import { ChatComposer } from "../src/components/ChatComposer.js";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
  writable: true,
});

const roots = new Set<Root>();

afterEach(() => {
  vi.unstubAllGlobals();
  act(() => {
    for (const root of roots) root.unmount();
  });
  roots.clear();
  document.body.replaceChildren();
});

function renderComposer(
  status: "idle" | "sending" = "idle",
  draft = "Inspect it",
  model?: import("../src/components/ChatComposer.js").ChatComposerModel,
  usage?: import("../src/components/ChatComposer.js").ChatComposerUsage,
  context?: import("@fungi.computer/shiitake/client").SessionContext,
) {
  const container = document.createElement("div");
  const root = createRoot(container);
  roots.add(root);
  const onSend = vi.fn();
  const onAbort = vi.fn();
  const textareaRef = createRef<HTMLTextAreaElement>();
  act(() => {
    root.render(
      <ChatComposer
        queuedRecall={undefined}
        draft={draft}
        model={model}
        usage={usage}
        context={context}
        failure={undefined}
        onAbort={onAbort}
        onChange={vi.fn()}
        onRetry={vi.fn()}
        onSend={onSend}
        status={status}
        viewState={{ kind: "idle" }}
        textareaRef={textareaRef}
      />,
    );
  });
  document.body.append(container);
  const textarea = container.querySelector("textarea");
  if (!(textarea instanceof HTMLTextAreaElement))
    throw new Error("Chat composer textarea is unavailable");
  return { container, onAbort, onSend, textarea };
}

it("keeps prompt copy sans on the composer surface, with one Caps send key", () => {
  const active = renderComposer("sending", "");
  const surface = active.container.querySelector<HTMLElement>(".caps-composer");
  const keys = active.container.querySelectorAll(".caps-send-action");

  expect(active.textarea.classList.contains("font-sans")).toBe(true);
  expect(active.textarea.classList.contains("font-mono")).toBe(false);
  expect(surface?.className).not.toContain("aura");
  expect(active.textarea.closest(".caps-composer-input")?.parentElement).toBe(
    surface,
  );
  expect(keys).toHaveLength(1);
  expect(keys[0]?.className).toContain("caps-keycap-button");
  expect(keys[0]?.closest(".caps-composer-bar")).not.toBeNull();
});

it("explains the single offline queue slot without implying an admission flood", () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  roots.add(root);
  act(() => {
    root.render(
      <ChatComposer
        queuedRecall={undefined}
        draft="Keep this second draft"
        failure={undefined}
        admissionError="offline_queue_full"
        onAbort={vi.fn()}
        onChange={vi.fn()}
        onRetry={vi.fn()}
        onSend={vi.fn()}
        status="idle"
        viewState={{ kind: "idle" }}
        textareaRef={createRef<HTMLTextAreaElement>()}
      />,
    );
  });
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    "One prompt is already queued; it sends when the service is back.",
  );
});

it.each(["admission", "failed", "interrupted"] as const)(
  "shows a Caps notice and retries a %s prompt",
  (failure) => {
    const container = document.createElement("div");
    const root = createRoot(container);
    roots.add(root);
    const onRetry = vi.fn();
    act(() => {
      root.render(
        <ChatComposer
          queuedRecall={undefined}
          draft=""
          failure={failure}
          onAbort={vi.fn()}
          onChange={vi.fn()}
          onRetry={onRetry}
          onSend={vi.fn()}
          status="error"
          viewState={{ kind: "error", cause: "Prompt failed" }}
          textareaRef={createRef<HTMLTextAreaElement>()}
        />,
      );
    });
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.classList.contains("caps-alert")).toBe(true);
    expect(alert?.textContent).toContain(
      "If the model didn’t start, there’s no charge.",
    );
    expect(alert?.textContent).toContain(
      "Model work already done can still use credits.",
    );
    const retry = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Retry prompt"]',
    );
    expect(retry).not.toBeNull();
    act(() => retry?.click());
    expect(onRetry).toHaveBeenCalledOnce();
  },
);

function enter(textarea: HTMLTextAreaElement, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key: "Enter",
    ...init,
  });
  act(() => {
    textarea.dispatchEvent(event);
  });
  return event;
}

it("keeps IME, normal Enter, and Shift+Enter submission semantics", () => {
  const idle = renderComposer();
  const nativeComposing = enter(idle.textarea, { isComposing: true });
  expect(idle.onSend).not.toHaveBeenCalled();
  expect(nativeComposing.defaultPrevented).toBe(false);

  const composing = enter(idle.textarea, { keyCode: 229 });
  expect(idle.onSend).not.toHaveBeenCalled();
  expect(composing.defaultPrevented).toBe(false);

  const normal = enter(idle.textarea);
  expect(idle.onSend).toHaveBeenCalledExactlyOnceWith("steer");
  expect(normal.defaultPrevented).toBe(true);

  const shifted = enter(idle.textarea, { shiftKey: true });
  expect(idle.onSend).toHaveBeenCalledTimes(1);
  expect(shifted.defaultPrevented).toBe(false);

  const busy = renderComposer("sending", "");
  const action = busy.container.querySelector<HTMLButtonElement>(
    '[aria-label="Stop current turn"]',
  );
  act(() => {
    action?.click();
  });
  expect(busy.onAbort).toHaveBeenCalledTimes(1);
});

it("leaves Enter to insert a newline when the primary pointer is coarse", () => {
  vi.stubGlobal("matchMedia", (media: string) => ({
    matches: media === "(pointer: coarse)",
    media,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }));

  const phone = renderComposer();
  const enterKey = enter(phone.textarea);

  expect(phone.onSend).not.toHaveBeenCalled();
  expect(enterKey.defaultPrevented).toBe(false);
});

it("submits the send button as steer without passing its click event", () => {
  const idle = renderComposer();
  const action = idle.container.querySelector<HTMLButtonElement>(
    '[aria-label="Send message"]',
  );
  expect(action?.disabled).toBe(false);
  expect(action?.className).toContain("caps-keycap-button");
  expect(action?.dataset.sendState).toBe("ready");
  act(() => {
    action?.click();
  });
  expect(idle.onSend).toHaveBeenCalledExactlyOnceWith("steer");
});

it("keeps the empty Send action readable and disabled", () => {
  const idle = renderComposer("idle", "");
  const action = idle.container.querySelector<HTMLButtonElement>(
    '[aria-label="Send message"]',
  );
  expect(action?.disabled).toBe(true);
  expect(action?.classList.contains("caps-keycap-button")).toBe(true);
  expect(action?.dataset.sendState).toBe("empty");
  act(() => {
    action?.click();
  });
  expect(idle.onSend).not.toHaveBeenCalled();
});

it("keeps composing during an active run and routes follow-ups through the one submit path", () => {
  const active = renderComposer("sending");
  expect(active.textarea.disabled).toBe(false);
  // A draft turns the running composer's one key into Queue, as Enter does;
  // Stop is not beside it.
  expect(
    active.container.querySelector('[aria-label="Stop current turn"]'),
  ).toBeNull();
  const followUp = active.container.querySelector<HTMLButtonElement>(
    '[aria-label="Queue follow-up"]',
  );
  act(() => {
    followUp?.click();
  });
  expect(active.onSend).toHaveBeenCalledExactlyOnceWith("followUp");
  expect(active.onAbort).not.toHaveBeenCalled();
  const event = enter(active.textarea);
  expect(event.defaultPrevented).toBe(true);
  expect(active.onSend).toHaveBeenCalledTimes(2);
  expect(active.onSend).toHaveBeenLastCalledWith("followUp");
});

it("turns the one Send key into Stop while a run works, without an Agent avatar", () => {
  const busy = renderComposer("sending", "");
  const stop = busy.container.querySelector<HTMLButtonElement>(
    '[aria-label="Stop current turn"]',
  );
  expect(stop?.disabled).toBe(false);
  expect(stop?.dataset.sendState).toBe("busy");
  expect(busy.container.querySelectorAll("button")).toHaveLength(1);
  expect(busy.container.querySelector("canvas, img")).toBeNull();

  const idle = renderComposer();
  expect(idle.container.querySelector("canvas, img")).toBeNull();
});

it.each([
  [{ kind: "waiting_for_you" }, "waiting for you"],
  [{ kind: "error", cause: "Prompt failed" }, "failed"],
  [{ kind: "idle" }, ""],
  [{ kind: "running_tool", tool: "read" }, ""],
  [{ kind: "connecting" }, ""],
  [{ kind: "disconnected", cause: "Watch lost" }, ""],
  [{ kind: "responding" }, ""],
  [{ kind: "thinking" }, ""],
  [{ kind: "compacting", trigger: "manual" }, ""],
  [{ kind: "queued", queuedCommandId: "queued-1", runningWork: null }, ""],
  [{ kind: "cancelling" }, ""],
  [
    {
      kind: "retrying",
      attempt: 1,
      maxAttempts: 3,
      cause: "Busy",
      nextRetryAt: 0,
    },
    "",
  ],
] satisfies readonly (readonly [
  import("../src/conversation.js").ParakeetSessionViewState,
  string,
])[])("keeps only attention readouts visible for %j", (viewState, label) => {
  const container = document.createElement("div");
  const root = createRoot(container);
  roots.add(root);
  act(() => {
    root.render(
      <ChatComposer
        queuedRecall={undefined}
        viewState={viewState}
        status="sending"
        draft=""
        failure={undefined}
        onAbort={vi.fn()}
        onChange={vi.fn()}
        onRetry={vi.fn()}
        onSend={vi.fn()}
        textareaRef={createRef<HTMLTextAreaElement>()}
      />,
    );
  });
  expect(container.querySelector(".composer-footer")?.textContent).toBe(label);
});

it("shows provider/model ids in the footer", () => {
  const { container } = renderComposer("idle", "Keep this draft", {
    provider: "openai",
    model: "gpt-6-astra",
  });
  const footer = container.querySelector(".composer-footer");
  expect(footer?.textContent).toContain("openai/gpt-6-astra");
  expect(footer?.textContent).not.toContain("@openai");
});

it("shows context used over the model's window after the model, and the tokens alone when the window is unknown", () => {
  const model = { provider: "openai", model: "gpt-6-astra" };
  const known = renderComposer("idle", "", model, undefined, {
    tokens: 12_345,
    window: 200_000,
  });
  expect(
    known.container.querySelector(".composer-footer")?.textContent,
  ).toContain("openai/gpt-6-astraSettings12K/200K");
  const unknown = renderComposer("idle", "", model, undefined, {
    tokens: 12_345,
    window: null,
  });
  const footer = unknown.container.querySelector(".composer-footer");
  expect(footer?.textContent).toMatch(/openai\/gpt-6-astraSettings12K$/u);
});

it("keeps one key in the same place as a run starts and ends", () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  roots.add(root);
  const render = (status: "idle" | "sending") => {
    act(() => {
      root.render(
        <ChatComposer
          queuedRecall={undefined}
          draft=""
          failure={undefined}
          onAbort={vi.fn()}
          onChange={vi.fn()}
          onRetry={vi.fn()}
          onSend={vi.fn()}
          status={status}
          viewState={{ kind: "idle" }}
          textareaRef={createRef<HTMLTextAreaElement>()}
        />,
      );
    });
  };
  render("idle");
  const send = container.querySelector('[aria-label="Send message"]');
  render("sending");
  const stop = container.querySelector('[aria-label="Stop current turn"]');
  expect(stop).toBe(send);
  expect(container.querySelectorAll("button")).toHaveLength(1);
});

it("shows images riding with the draft above the text", () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  roots.add(root);
  act(() => {
    root.render(
      <ChatComposer
        queuedRecall={{
          images: [{ type: "image", mimeType: "image/png", data: "AAAA" }],
          recallState: { kind: "idle" },
          recall: () => Promise.resolve("empty"),
        }}
        draft=""
        failure={undefined}
        onAbort={vi.fn()}
        onChange={vi.fn()}
        onRetry={vi.fn()}
        onSend={vi.fn()}
        status="idle"
        viewState={{ kind: "idle" }}
        textareaRef={createRef<HTMLTextAreaElement>()}
      />,
    );
  });
  const image = container.querySelector<HTMLImageElement>(
    ".caps-composer-attachments img",
  );
  expect(image?.alt).toBe("Attached image 1");
  expect(image?.getAttribute("src")).toBe("data:image/png;base64,AAAA");
  expect(
    container.querySelector<HTMLButtonElement>('[aria-label="Send message"]')
      ?.disabled,
  ).toBe(false);
});

it.each([
  [0, "0 tok"],
  [2, "2 tok"],
  [49, "49 tok"],
  [999, "999 tok"],
  [1000, "1.0K"],
  [1200, "1.2K"],
  [12500, "12.5K"],
])("shows %i tokens in the footer as %s", (tokens, expected) => {
  const { container } = renderComposer("idle", "Keep this draft", undefined, {
    tokens,
    cost: 0,
  });
  expect(container.querySelector(".composer-footer")?.textContent).toContain(
    expected,
  );
});

it("offers Attach only when the host takes images, and removes one in place", () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  roots.add(root);
  const onImagesChange = vi.fn();
  const images = [
    { type: "image" as const, mimeType: "image/png", data: "AAAA" },
    { type: "image" as const, mimeType: "image/png", data: "BBBB" },
  ];
  act(() => {
    root.render(
      <ChatComposer
        queuedRecall={{
          images,
          recallState: { kind: "idle" },
          recall: () => Promise.resolve("empty"),
        }}
        onImagesChange={onImagesChange}
        draft=""
        failure={undefined}
        onAbort={vi.fn()}
        onChange={vi.fn()}
        onRetry={vi.fn()}
        onSend={vi.fn()}
        status="idle"
        viewState={{ kind: "idle" }}
        textareaRef={createRef<HTMLTextAreaElement>()}
      />,
    );
  });
  const attach = container.querySelector('[aria-label="Attach images"]');
  expect(attach?.classList.contains("caps-keycap-button")).toBe(true);
  expect(
    container.querySelector<HTMLInputElement>('input[type="file"]')?.accept,
  ).toBe("image/png,image/jpeg,image/gif,image/webp");
  act(() => {
    container
      .querySelector<HTMLButtonElement>(
        '[aria-label="Remove attached image 1"]',
      )
      ?.click();
  });
  expect(onImagesChange).toHaveBeenCalledExactlyOnceWith([images[1]]);

  const visitor = renderComposer();
  expect(
    visitor.container.querySelector('[aria-label="Attach images"]'),
  ).toBeNull();
});

it("opens the Session's own /model command from the model key", () => {
  const store = createParakeetInteractions();
  const runCommand = vi.fn();
  const slash: SlashCommandController = {
    completion: { kind: "none" },
    open: false,
    selected: 0,
    hints: [],
    interactions: store.snapshot(),
    store,
    awaiting: { items: [], position: 0, total: 0, forced: false },
    move: () => false,
    highlight: () => undefined,
    complete: () => false,
    dismiss: () => false,
    submit: () => undefined,
    choose: () => undefined,
    available: (alias) => alias === "model",
    runCommand,
  };
  const container = document.createElement("div");
  const root = createRoot(container);
  roots.add(root);
  act(() => {
    root.render(
      <ChatComposer
        queuedRecall={undefined}
        draft="Keep this draft"
        model={{ provider: "openai", model: "gpt-6-astra" }}
        failure={undefined}
        onAbort={vi.fn()}
        onChange={vi.fn()}
        onRetry={vi.fn()}
        onSend={vi.fn()}
        status="idle"
        viewState={{ kind: "idle" }}
        textareaRef={createRef<HTMLTextAreaElement>()}
        slash={slash}
      />,
    );
  });
  const key = container.querySelector<HTMLButtonElement>(
    '[aria-label="Model: openai/gpt-6-astra. Change model"]',
  );
  expect(key?.classList.contains("caps-keycap-button")).toBe(true);
  act(() => {
    key?.click();
  });
  expect(runCommand).toHaveBeenCalledExactlyOnceWith("model");
  expect(container.querySelector("textarea")?.value).toBe("Keep this draft");
});
