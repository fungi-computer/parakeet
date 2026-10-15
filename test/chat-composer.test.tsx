// @vitest-environment jsdom
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import { ChatComposer } from "../src/components/ChatComposer.js";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
  writable: true,
});

const roots = new Set<Root>();

afterEach(() => {
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

it("keeps prompt copy sans and renders Queue through Caps' disabled contract", () => {
  const active = renderComposer("sending", "");
  const row = active.container.querySelector<HTMLElement>(
    ".caps-composer > .join",
  );
  const queue = active.container.querySelector<HTMLButtonElement>(
    '[aria-label="Queue follow-up"]',
  );

  expect(active.textarea.classList.contains("font-sans")).toBe(true);
  expect(active.textarea.classList.contains("font-mono")).toBe(false);
  expect(row?.className).not.toContain("aura");
  expect(queue?.disabled).toBe(true);
  expect(queue?.className).toContain("caps-button");
  expect(queue?.className).toContain("btn-primary");
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

  const busy = renderComposer("sending");
  const action = busy.container.querySelector<HTMLButtonElement>(
    '[data-testid="composer-stop"]',
  );
  act(() => {
    action?.click();
  });
  expect(busy.onAbort).toHaveBeenCalledTimes(1);
});

it("submits the send button as steer without passing its click event", () => {
  const idle = renderComposer();
  const action = idle.container.querySelector<HTMLButtonElement>(
    '[aria-label="Send message"]',
  );
  expect(action?.textContent).toBe("Send");
  expect(action?.disabled).toBe(false);
  expect(action?.className).toContain("caps-button");
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
  expect(action?.textContent).toBe("Send");
  expect(action?.disabled).toBe(true);
  expect(action?.classList.contains("caps-button-filled")).toBe(true);
  expect(action?.classList.contains("disabled:pointer-events-none")).toBe(true);
  act(() => {
    action?.click();
  });
  expect(idle.onSend).not.toHaveBeenCalled();
});

it("keeps composing during an active run and routes follow-ups through the one submit path", () => {
  const active = renderComposer("sending");
  expect(active.textarea.disabled).toBe(false);
  const followUp = active.container.querySelector<HTMLButtonElement>(
    '[aria-label="Queue follow-up"]',
  );
  const cancel = active.container.querySelector<HTMLButtonElement>(
    '[aria-label="Stop current turn"]',
  );
  act(() => {
    followUp?.click();
    cancel?.click();
  });
  expect(active.onSend).toHaveBeenCalledExactlyOnceWith("followUp");
  expect(active.onAbort).toHaveBeenCalledTimes(1);
  const event = enter(active.textarea);
  expect(event.defaultPrevented).toBe(true);
  expect(active.onSend).toHaveBeenCalledTimes(2);
  expect(active.onSend).toHaveBeenLastCalledWith("followUp");
});

it("offers plain Caps Stop and Send actions without an Agent avatar", () => {
  const busy = renderComposer("sending");
  const stop = busy.container.querySelector<HTMLButtonElement>(
    '[data-testid="composer-stop"]',
  );
  expect(stop?.textContent).toBe("Stop");
  expect(stop?.className).toContain("caps-button");
  expect(busy.container.querySelector("canvas, img")).toBeNull();

  const idle = renderComposer();
  expect(idle.container.querySelector("canvas, img")).toBeNull();
});

it.each([
  [{ kind: "waiting_for_you" }, "waiting for you"],
  [{ kind: "running_tool", tool: "read" }, "running read"],
  [{ kind: "connecting" }, "connecting"],
  [{ kind: "disconnected", cause: "Watch lost" }, "unavailable"],
  [{ kind: "responding" }, "writing"],
] satisfies readonly (readonly [
  import("../src/conversation.js").ParakeetSessionViewState,
  string,
])[])(
  "shows the owner view %j instead of a coarse composer status",
  (viewState, label) => {
    const container = document.createElement("div");
    const root = createRoot(container);
    roots.add(root);
    act(() => {
      root.render(
        <ChatComposer
          viewState={viewState}
          status="idle"
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
    expect(container.querySelector(".composer-footer")?.textContent).toBe(
      label,
    );
  },
);

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
  ).toContain("openai/gpt-6-astra12K/200K");
  const unknown = renderComposer("idle", "", model, undefined, {
    tokens: 12_345,
    window: null,
  });
  const footer = unknown.container.querySelector(".composer-footer");
  expect(footer?.textContent).toMatch(/openai\/gpt-6-astra12K$/u);
});

it("lets a host render readable text actions without a portrait", () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  roots.add(root);
  const render = (status: "idle" | "sending") => {
    act(() => {
      root.render(
        <ChatComposer
          draft="A visitor message"
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
  expect(send?.textContent).toBe("Send");
  expect(send?.querySelector('[aria-hidden="true"]')).toBeNull();
  render("sending");
  const stop = container.querySelector('[aria-label="Stop current turn"]');
  expect(stop?.textContent).toBe("Stop");
  expect(stop?.querySelector('[aria-hidden="true"]')).toBeNull();
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
