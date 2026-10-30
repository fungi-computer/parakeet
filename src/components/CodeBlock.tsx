import { IconButton } from "@fungi.computer/caps/components/icon-button";
import { Check, Copy } from "lucide-react";
import { type CSSProperties, type ReactNode, useState } from "react";

import { reportFailure } from "../lib/failure.js";
import { highlightToHtml } from "@fungi.computer/caps/lib/tanstack-highlight";

const HIGHLIGHT_THRESHOLD = 10_000;

export type CodeBlockProps = {
  className?: string;
  content: string;
  header?: ReactNode;
  hideCopy?: boolean;
  language?: string;
  maxHeight?: string;
  style?: CSSProperties;
};

export function CodeBlock({
  className,
  content,
  header,
  hideCopy,
  language,
  maxHeight = "320px",
  style,
}: CodeBlockProps) {
  const [copyState, setCopyState] = useState<"copied" | "failed" | "idle">(
    "idle",
  );

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopyState("copied");
      setTimeout(() => {
        setCopyState("idle");
      }, 1500);
    } catch (cause) {
      reportFailure("copy code to clipboard", cause);
      setCopyState("failed");
    }
  };

  const shouldHighlight =
    Boolean(language) && content.length <= HIGHLIGHT_THRESHOLD;
  const innerHtml = shouldHighlight ? highlightToHtml(content, language) : null;
  const containerStyle: CSSProperties = {
    background: "var(--stipe-surface)",
    border: "1px solid var(--color-base-300)",
    color: "var(--color-base-content)",
    ...style,
  };

  return (
    <div
      className={`relative not-prose ${className ?? ""}`}
      style={containerStyle}
    >
      {header ? (
        <div className="text-dim px-2 pt-1.5 pb-1 text-[9px] uppercase tracking-wider">
          {header}
        </div>
      ) : null}
      {!hideCopy ? (
        <IconButton
          aria-label="Copy to clipboard"
          className="absolute top-1 right-1 z-10"
          icon={copyState === "copied" ? <Check /> : <Copy />}
          onClick={() => {
            void handleCopy();
          }}
          type="button"
        />
      ) : null}
      {!hideCopy ? (
        <span aria-live="polite" className="sr-only" role="status">
          {copyState === "failed" ? "Copy to clipboard failed." : null}
        </span>
      ) : null}
      <div
        className="overflow-y-auto text-[10px]"
        data-scrollable
        style={{
          maxHeight: maxHeight === "0" ? undefined : maxHeight,
          padding: "6px 4px",
        }}
      >
        {innerHtml === null ? (
          <pre
            className="whitespace-pre-wrap break-words font-mono text-base-content"
            style={{ margin: 0 }}
          >
            {content}
            {content.length > HIGHLIGHT_THRESHOLD ? (
              <span className="text-dim ml-2 italic">
                (syntax highlighting skipped for very long content)
              </span>
            ) : null}
          </pre>
        ) : (
          <div
            // TanStack Highlight escapes source text; output is token spans.
            dangerouslySetInnerHTML={{ __html: innerHtml }}
          />
        )}
      </div>
    </div>
  );
}
