import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ChatMessage } from "../src/components/ChatMessage.js";

describe("the simple transcript", () => {
  it("announces a pending user message without relying on opacity", () => {
    const pending = renderToStaticMarkup(
      <ChatMessage speaker="user" pending>
        Keep these words
      </ChatMessage>,
    );
    expect(pending).toContain('role="status"');
    expect(pending).toContain("Sending");
    expect(
      renderToStaticMarkup(
        <ChatMessage speaker="user">Keep these words</ChatMessage>,
      ),
    ).not.toContain("Sending");
  });
  it("renders visitor Markdown labels without loading images or unsafe links", () => {
    const markup = renderToStaticMarkup(
      <ChatMessage speaker="agent" markdownPolicy="visitor">
        {
          "![pixel](https://tracker.invalid/image) [Help](https://example.com/help) [Unsafe](javascript:alert(1))"
        }
      </ChatMessage>,
    );
    expect(markup).not.toContain("<img");
    expect(markup).not.toContain("tracker.invalid");
    expect(markup).not.toContain('href="javascript:');
    expect(markup).toContain('href="https://example.com/help"');
    expect(markup).toContain(">Help</a>");
    expect(markup).not.toContain("![pixel]");
  });
  it("uses a full-width user rail and one unboxed Agent column", () => {
    const user = renderToStaticMarkup(
      <ChatMessage speaker="user">hello</ChatMessage>,
    );
    const agent = renderToStaticMarkup(
      <ChatMessage speaker="agent">Nice to meet you</ChatMessage>,
    );
    expect(user).toContain("border-left:3px solid var(--color-primary)");
    for (const markup of [user, agent]) {
      expect(markup).not.toContain("caps-chat");
      expect(markup).not.toContain("data-side");
      expect(markup).not.toContain("data-agent-head");
      expect(markup).not.toContain("<time");
    }
    expect(agent).toContain("Nice to meet you");
  });

  it("does not guess thinking or writing from an unfinished turn", () => {
    const markup = renderToStaticMarkup(
      <ChatMessage pending thinking="Check the beds" speaker="agent">
        Half a sentence
      </ChatMessage>,
    );
    expect(markup).toContain("Half a sentence");
    expect(markup).toContain("Thoughts");
    expect(markup).not.toContain("writing…");
    expect(markup).not.toContain("caps-chat-typing");
    expect(
      renderToStaticMarkup(
        <ChatMessage pending speaker="agent">
          {""}
        </ChatMessage>,
      ),
    ).toBe("");
  });

  it("keeps failed content readable without a bubble", () => {
    const failed = renderToStaticMarkup(
      <ChatMessage isError speaker="agent">
        It stopped
      </ChatMessage>,
    );
    expect(failed).toContain("text-error");
    expect(failed).toContain("It stopped");
    expect(
      renderToStaticMarkup(<ChatMessage speaker="agent">{""}</ChatMessage>),
    ).toBe("");
  });
});
