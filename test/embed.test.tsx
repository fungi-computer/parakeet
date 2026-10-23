import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { Parakeet } from "../src/parakeet.js";
import type { ParakeetSession } from "../src/session.js";
import {
  commandHandler,
  noExtension,
  sessionSnapshot,
} from "./fixtures/session.fixture.js";
import type { SessionFrame } from "@fungi.computer/shiitake/client";
import { createWhistle } from "@fungi.computer/whistle";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  value: true,
  configurable: true,
});
Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
  value: () => undefined,
  configurable: true,
});

describe("the actual Parakeet visitor conversation", () => {
  it("uses its own composer and records held prompts without inventing accepted work", async () => {
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(800);
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(800);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const queryClient = new QueryClient();
    const commands = createWhistle();
    const prompts: string[] = [];
    let finish: ((result: IteratorResult<SessionFrame>) => void) | undefined;
    let closed = 0;
    const snapshot = sessionSnapshot();
    const session: ParakeetSession = {
      latestPending: () => Promise.resolve(null),
      withdraw: () => Promise.resolve({ status: "unknown" }),
      address: "https://embed.example/visitor-session",
      read: () => Promise.resolve(snapshot),
      command: commandHandler((input) => {
        prompts.push(input.text);
        return Promise.resolve({ status: "recorded" });
      }),
      extension: noExtension,
      watch: () =>
        Promise.resolve({
          snapshot,
          changes: {
            [Symbol.asyncIterator]: () => ({
              next: () =>
                new Promise((resolve) => {
                  finish = resolve;
                }),
            }),
          },
          close: () => {
            closed++;
            finish?.({ done: true, value: undefined });
            return Promise.resolve();
          },
        }),
    };
    const settle = async () =>
      act(async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      });
    try {
      await act(async () => {
        root.render(
          <QueryClientProvider client={queryClient}>
            <Parakeet
              session={session}
              commands={commands}
              markdownPolicy="visitor"
              visitor={{ agentName: "Front Desk" }}
            />
          </QueryClientProvider>,
        );
        await Promise.resolve();
      });
      await settle();
      await settle();
      expect(host.querySelector('[data-parakeet="standalone"]')).not.toBeNull();
      const textarea = host.querySelector("textarea");
      if (textarea === null) throw new Error("Parakeet composer missing");
      expect(textarea.className).toContain("resize-none");
      expect(textarea.placeholder).toBe("Ask Front Desk…");
      expect(host.querySelector(".composer-footer")).toBeNull();
      expect(host.querySelector(".parakeet-key-hints")).toBeNull();
      expect(commands.snapshot().slash).toEqual([]);
      const descriptor = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      );
      if (descriptor?.set === undefined)
        throw new Error("Textarea setter missing");
      const setValue = descriptor.set.bind(textarea);
      await act(async () => {
        setValue("Please ask a person");
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
        await Promise.resolve();
      });
      const send = host.querySelector('button[aria-label="Send message"]');
      if (!(send instanceof HTMLButtonElement))
        throw new Error("Parakeet send action missing");
      await act(async () => {
        send.click();
        await Promise.resolve();
      });
      await settle();
      expect(prompts).toEqual(["Please ask a person"]);
      expect(textarea.value).toBe("");
      expect(host.textContent).not.toContain("Prompt accepted");
      expect(host.textContent).not.toContain("Sending…");
      await act(async () => {
        setValue("/clear");
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
        await Promise.resolve();
      });
      expect(host.querySelector("[data-parakeet-slash]")).toBeNull();
      await act(async () => {
        textarea.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
        );
        await Promise.resolve();
      });
      await settle();
      expect(prompts).toEqual(["Please ask a person", "/clear"]);
    } finally {
      await act(async () => {
        root.unmount();
        await Promise.resolve();
      });
      queryClient.clear();
      host.remove();
      vi.restoreAllMocks();
    }
    expect(closed).toBe(1);
  });
});
