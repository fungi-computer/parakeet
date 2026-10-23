import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChatMessage } from "../src/components/ChatMessage.js";
import { TimelineItem } from "../src/components/TimelineItem.js";
import type { UserMessageItem } from "../src/store/types.js";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});

const roots = new Set<Root>();
afterEach(() => {
  act(() => {
    for (const root of roots) root.unmount();
  });
  roots.clear();
  document.body.replaceChildren();
});

function mount() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.add(root);
  const dismiss = vi.fn<(requestId: string) => void>();
  return {
    host,
    dismiss,
    render(item: UserMessageItem) {
      act(() => {
        root.render(<TimelineItem item={item} onDismissFailed={dismiss} />);
      });
    },
  };
}

function message(
  status: UserMessageItem["status"],
  author: UserMessageItem["author"],
): UserMessageItem {
  return {
    id: "same-message-row",
    kind: "user_message",
    requestId: "original-caller-request",
    text: "Keep these exact words",
    status,
    author,
  };
}

const authors: Readonly<{
  label: string;
  author: UserMessageItem["author"];
}>[] = [
  { label: "unattributed user", author: undefined },
  { label: "named human", author: { id: "human", name: "Human" } },
  {
    label: "collapsed Agent-authored user message",
    author: { id: "other-agent", name: "Other Agent", kind: "agent" },
  },
];
const waitingStates: UserMessageItem["status"][] = ["pending", "queued"];
const settledStates: UserMessageItem["status"][] = [
  "accepted",
  "confirmed",
  "failed",
];

describe.each(authors)("$label", ({ author }) => {
  it.each(waitingStates)(
    "announces %s text without relying on opacity or opening its disclosure",
    (status) => {
      const view = mount();
      view.render(message(status, author));
      const announcements = view.host.querySelectorAll('[role="status"]');
      expect(announcements).toHaveLength(1);
      expect(announcements[0]?.textContent).toBe("Sending");
      expect(announcements[0]?.classList.contains("sr-only")).toBe(true);
      expect(announcements[0]?.closest("button")).toBeNull();
      expect(view.host.textContent).toContain("Keep these exact words");
      if (author?.kind === "agent") {
        const disclosure = view.host.querySelector("button[aria-expanded]");
        expect(disclosure?.getAttribute("aria-expanded")).toBe("false");
        expect(disclosure?.textContent).not.toContain("Sending");
      }
    },
  );

  it.each(settledStates)(
    "does not announce %s text as still sending",
    (status) => {
      const view = mount();
      view.render(message(status, author));
      expect(view.host.querySelector('[role="status"]')).toBeNull();
      expect(view.host.textContent).toContain("Keep these exact words");
      if (status === "failed") {
        expect(view.host.querySelector('[role="alert"]')).not.toBeNull();
        const dismiss = view.host.querySelector<HTMLButtonElement>(
          'button[aria-label="Dismiss failed prompt"]',
        );
        if (dismiss === null)
          throw new Error("Failed prompt dismissal missing");
        act(() => {
          dismiss.click();
        });
        expect(view.dismiss).toHaveBeenCalledExactlyOnceWith(
          "original-caller-request",
        );
      }
    },
  );

  it("clears the pending announcement when the same row becomes confirmed", () => {
    const view = mount();
    view.render(message("pending", author));
    expect(view.host.querySelectorAll('[role="status"]')).toHaveLength(1);
    view.render(message("queued", author));
    expect(view.host.querySelectorAll('[role="status"]')).toHaveLength(1);
    view.render(message("confirmed", author));
    expect(view.host.querySelector('[role="status"]')).toBeNull();
    expect(view.host.textContent).toContain("Keep these exact words");
  });
});

it("does not call unfinished assistant output a sending user message", () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.add(root);
  act(() => {
    root.render(
      <ChatMessage speaker="agent" pending>
        Assistant output is still arriving
      </ChatMessage>,
    );
  });
  expect(host.querySelector('[role="status"]')).toBeNull();
  expect(host.textContent).toContain("Assistant output is still arriving");
});
