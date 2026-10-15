import { parseMarkdown } from "@tanstack/markdown/parser";
import { useMemo } from "react";

export type {
  BlockNode as MarkdownBlock,
  InlineNode as MarkdownInline,
} from "@tanstack/markdown";

/** Parse chat Markdown for headless hosts, including terminal presentation. */
export function useMarkdown(content: string) {
  return useMemo(
    () => parseMarkdown(content, { allowHtml: false, frontmatter: false }),
    [content],
  );
}
