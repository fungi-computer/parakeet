import { ChevronRight } from "lucide-react";
import { memo, useState } from "react";

import { MarkdownRenderer } from "./MarkdownRenderer.js";

export const ThinkingBlock = memo(function ThinkingBlock({
  thinking,
}: {
  thinking: string;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div>
      <button
        aria-expanded={expanded}
        className="flex h-8 w-full items-center gap-2 px-3 text-left text-[10px] uppercase tracking-wider transition-colors"
        onClick={() => {
          setExpanded((previous) => !previous);
        }}
        style={{
          color: "var(--stipe-fg-muted)",
          fontFamily: "var(--font-sans)",
          fontStyle: "italic",
        }}
        type="button"
      >
        Thoughts
        <span
          aria-hidden="true"
          className="btn btn-circle btn-ghost btn-xs ml-auto text-dim"
          style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}
        >
          <ChevronRight size={12} />
        </span>
      </button>
      {expanded ? (
        <div
          className="max-w-[80ch] break-words px-3 pb-2 text-[11px]"
          style={{
            color: "var(--stipe-fg-muted)",
            fontFamily: "var(--font-sans)",
            fontStyle: "italic",
          }}
        >
          <MarkdownRenderer>{thinking}</MarkdownRenderer>
        </div>
      ) : null}
    </div>
  );
});
