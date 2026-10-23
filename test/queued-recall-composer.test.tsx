import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createWhistle } from "@fungi.computer/whistle";
import { afterEach, expect, it, vi } from "vitest";
import type {
  SessionCommand,
  SessionPendingPrompt,
} from "@fungi.computer/shiitake/client";
import {
  ParakeetProvider,
  useComposer,
  type ComposerController,
} from "../src/headless.js";
import { ParakeetView } from "../src/parakeet.js";
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
});
const roots: Root[] = [];
afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
  localStorage.clear();
});

const prompt: SessionPendingPrompt = {
  commandId: "B",
  requestId: "request-B",
  text: "B exact\n",
  delivery: "followUp",
  images: [{ type: "image", data: "aGVsbG8=", mimeType: "image/png" }],
};

async function mount(
  address = "test://recall-composer",
  onPrompt: Parameters<typeof commandHandler>[0] = commandResult,
) {
  const commands: SessionCommand[] = [];
  const latestPending = vi.fn(() => Promise.resolve(prompt));
  const withdraw = vi.fn<ParakeetSession["withdraw"]>(() =>
    Promise.resolve({ status: "unknown" }),
  );
  const snapshot = sessionSnapshot();
  const session: ParakeetSession = {
    address,
    latestPending,
    withdraw,
    command: commandHandler(
      (input) => {
        commands.push(input);
        return onPrompt(input);
      },
      undefined,
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
        changes: {
          [Symbol.asyncIterator]: () => ({
            next: () => new Promise(() => undefined),
            return: () => Promise.resolve({ done: true, value: undefined }),
          }),
        },
        close: () => Promise.resolve(),
      }),
  };
  let controller: ComposerController | undefined;
  function Probe() {
    controller = useComposer();
    return null;
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  await act(async () => {
    await Promise.resolve();
    root.render(
      <QueryClientProvider client={queryClient}>
        <ParakeetProvider
          session={session}
          draftIdentity={{ agentId: "agent", sessionId: "session" }}
          draftStorage={localStorage}
        >
          <Probe />
          <ParakeetView commands={createWhistle()} />
        </ParakeetProvider>
      </QueryClientProvider>,
    );
  });
  const input = container.querySelector("textarea");
  if (input === null) throw new Error("Missing composer");
  input.focus();
  return {
    input,
    commands,
    latestPending,
    withdraw,
    close() {
      act(() => {
        root.unmount();
      });
      roots.splice(roots.indexOf(root), 1);
      queryClient.clear();
      container.remove();
    },
    composer() {
      if (controller === undefined) throw new Error("Missing controller");
      return controller;
    },
  };
}

it("routes real empty-composer Up through owner cancellation, restores images, and explains the key accessibly", async () => {
  const f = await mount();
  const guidance = f.input.getAttribute("aria-describedby");
  expect(guidance).toContain("recall-guidance");
  await act(async () => {
    await Promise.resolve();
    f.input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowUp",
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  expect(f.commands).toEqual([
    { type: "cancel", commandId: "B", onlyIfPending: true },
  ]);
  expect(f.input.value).toBe(prompt.text);
  expect(f.composer().images).toEqual(prompt.images);
  expect(f.input.selectionStart).toBe(prompt.text.length);
  expect(document.activeElement).toBe(f.input);
  expect(f.input.readOnly).toBe(false);
  expect(f.composer().checkpointDraft()).toEqual({ status: "saved" });
  await act(async () => {
    await Promise.resolve();
    f.composer().send();
  });
  const submitted = f.commands.find((command) => command.type === "prompt");
  expect(submitted).toMatchObject({
    text: prompt.text,
    images: prompt.images,
    delivery: prompt.delivery,
  });
  if (submitted?.type !== "prompt") throw new Error("Missing resend");
  expect(submitted.requestId).not.toBe(prompt.requestId);
});

it("keeps image-only cargo ineligible for recall and resends it with Enter and a fresh request", async () => {
  const f = await mount();
  await act(async () => {
    await f.composer().recall();
  });
  act(() => {
    f.composer().setDraft("");
  });
  await act(async () => {
    f.input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowUp",
        bubbles: true,
        cancelable: true,
      }),
    );
    await Promise.resolve();
  });
  expect(f.latestPending).toHaveBeenCalledTimes(1);
  expect(f.composer().images).toEqual(prompt.images);
  await act(async () => {
    f.input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
    await Promise.resolve();
  });
  const submitted = f.commands.find((command) => command.type === "prompt");
  expect(submitted).toMatchObject({
    text: "",
    images: prompt.images,
    delivery: prompt.delivery,
  });
  if (submitted?.type !== "prompt") throw new Error("Missing image resend");
  expect(submitted.requestId).not.toBe(prompt.requestId);
});

it("preserves recalled images and exact intent when confirmed withdrawal retries with a fresh identity", async () => {
  let attempts = 0;
  const f = await mount("test://recall-image-retry", (input) => {
    attempts += 1;
    return attempts === 1
      ? Promise.reject(new Error("Admission response lost"))
      : commandResult(input);
  });
  await act(async () => {
    await f.composer().recall();
  });
  await act(async () => {
    f.composer().send();
    await Promise.resolve();
  });
  const first = f.commands.find((command) => command.type === "prompt");
  if (first?.type !== "prompt") throw new Error("Missing first admission");
  expect(first).toMatchObject({
    text: prompt.text,
    delivery: prompt.delivery,
    images: prompt.images,
  });
  expect(f.withdraw).toHaveBeenCalledExactlyOnceWith(first.requestId);
  expect(f.input.value).toBe(prompt.text);
  expect(f.composer().images).toEqual(prompt.images);
  await act(async () => {
    f.composer().retry();
    await Promise.resolve();
  });
  const submitted = f.commands.filter((command) => command.type === "prompt");
  expect(submitted).toHaveLength(2);
  const retry = submitted[1];
  if (retry === undefined) throw new Error("Missing retry admission");
  expect(retry).toMatchObject({
    text: prompt.text,
    delivery: prompt.delivery,
    images: prompt.images,
  });
  expect(retry.requestId).not.toBe(first.requestId);
  expect(f.input.value).toBe("");
  expect(f.composer().images).toBeUndefined();
});

it("does not recall a draft or accept modified/repeat Up as recall gestures", async () => {
  const f = await mount();
  act(() => {
    f.composer().setDraft("keep my draft");
  });
  await act(async () => {
    await Promise.resolve();
    f.input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
    );
  });
  expect(f.input.value).toBe("keep my draft");
  act(() => {
    f.composer().setDraft("");
  });
  for (const modifiers of [
    { shiftKey: true },
    { altKey: true },
    { ctrlKey: true },
    { metaKey: true },
    { repeat: true },
  ]) {
    await act(async () => {
      await Promise.resolve();
      f.input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowUp",
          bubbles: true,
          ...modifiers,
        }),
      );
    });
  }
  expect(f.latestPending).not.toHaveBeenCalled();
  expect(f.commands).toEqual([]);
});

it("checkpoints recalled text/images/delivery in the same stable journal across a transport-address change", async () => {
  const first = await mount("http://old-service/sessions/session");
  await act(async () => {
    await Promise.resolve();
    first.input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowUp",
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  expect(first.composer().checkpointDraft()).toEqual({ status: "saved" });
  first.close();
  const resumed = await mount("http://new-service/sessions/session");
  expect(resumed.input.value).toBe(prompt.text);
  expect(resumed.composer().images).toEqual(prompt.images);
  await act(async () => {
    resumed.composer().send();
    await Promise.resolve();
  });
  expect(
    resumed.commands.find((command) => command.type === "prompt"),
  ).toMatchObject({
    text: prompt.text,
    images: prompt.images,
    delivery: prompt.delivery,
  });
});
