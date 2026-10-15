import { MarkdownRenderer } from "./MarkdownRenderer.js";
import { ThinkingBlock } from "./ThinkingBlock.js";

export function ChatMessage({
  children,
  isError,
  pending,
  speaker,
  thinking,
  markdownPolicy,
}: Readonly<{
  children: string;
  isError?: boolean;
  pending?: boolean;
  speaker: "agent" | "user";
  thinking?: string;
  markdownPolicy?: "session" | "visitor";
}>) {
  const content = (
    <MarkdownRenderer policy={markdownPolicy}>{children}</MarkdownRenderer>
  );
  if (speaker === "user") {
    return (
      <div
        className={`px-3 py-2 transition-opacity motion-reduce:transition-none ${pending ? "opacity-50" : ""}`}
        data-pending={pending ? "true" : undefined}
        data-speaker="user"
        style={{
          background: "var(--stipe-surface)",
          borderLeft: "3px solid var(--color-primary)",
        }}
      >
        <div className="message-body text-base-content">{content}</div>
      </div>
    );
  }
  const hasText = children.trim().length > 0;
  if (!hasText && !thinking) return null;
  return (
    <div data-speaker="agent" data-pending={pending ? "true" : undefined}>
      {thinking ? <ThinkingBlock thinking={thinking} /> : null}
      {hasText ? (
        <div
          className={`px-3 py-2 ${isError ? "text-error" : "text-base-content"}`}
        >
          {content}
        </div>
      ) : null}
    </div>
  );
}
