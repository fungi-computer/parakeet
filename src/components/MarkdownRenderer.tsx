import type {
  MarkdownComponentProps,
  MarkdownComponents,
} from "@tanstack/markdown/react";
import { Markdown } from "@fungi.computer/caps/components/markdown";
import { cn } from "@fungi.computer/caps/lib/cn";
import { createContext, useContext } from "react";

export type MarkdownRendererProps = {
  children: string;
  policy?: "session" | "visitor" | undefined;
};

export const MarkdownPolicyContext = createContext<"session" | "visitor">(
  "session",
);

const components = {
  blockquote({ children }: MarkdownComponentProps<"blockquote">) {
    return (
      <blockquote className="text-dim my-2 border-l-2 border-primary pl-3 italic">
        {children}
      </blockquote>
    );
  },
  pre({ children, className, ...props }: MarkdownComponentProps<"pre">) {
    return (
      <pre
        {...props}
        className={cn("whitespace-pre-wrap break-words", className)}
      >
        {children}
      </pre>
    );
  },
  img({ alt, src }: MarkdownComponentProps<"img">) {
    const source = src ?? "";
    if (source.startsWith("/")) {
      return (
        <div
          className="my-2 px-3 py-2 font-mono text-[10px]"
          style={{
            background: "var(--stipe-surface-selected)",
            border: "1px solid var(--color-base-300)",
          }}
        >
          <span className="text-dim">{alt ?? "Generated image"}</span>
          <span className="text-dim mx-2">·</span>
          <span style={{ color: "var(--color-base-content)" }}>{source}</span>
        </div>
      );
    }
    return (
      <img
        alt={alt ?? "Image"}
        className="my-2 max-w-full"
        src={source}
        style={{ maxHeight: 400 }}
      />
    );
  },
  strong({ children }: MarkdownComponentProps<"strong">) {
    return <strong className="font-semibold text-primary">{children}</strong>;
  },
  table({ children }: MarkdownComponentProps<"table">) {
    return (
      <table className="my-2 w-full border-collapse text-xs">{children}</table>
    );
  },
  thead({ children }: MarkdownComponentProps<"thead">) {
    return (
      <thead style={{ background: "var(--stipe-surface-selected)" }}>
        {children}
      </thead>
    );
  },
  th({ children }: MarkdownComponentProps<"th">) {
    return (
      <th
        className="border px-3 py-2 text-left font-semibold"
        style={{ borderColor: "var(--color-base-300)" }}
      >
        {children}
      </th>
    );
  },
  td({ children }: MarkdownComponentProps<"td">) {
    return (
      <td
        className="border px-3 py-2"
        style={{ borderColor: "var(--color-base-300)" }}
      >
        {children}
      </td>
    );
  },
  tr({ children }: MarkdownComponentProps<"tr">) {
    return <tr>{children}</tr>;
  },
  tbody({ children }: MarkdownComponentProps<"tbody">) {
    return <tbody>{children}</tbody>;
  },
} satisfies MarkdownComponents;

export function MarkdownRenderer({ children, policy }: MarkdownRendererProps) {
  const inheritedPolicy = useContext(MarkdownPolicyContext);
  return (
    <Markdown
      className="markdown-renderer"
      components={components}
      frontmatter={false}
      policy={(policy ?? inheritedPolicy) === "visitor" ? "visitor" : "default"}
      typography="inherit"
    >
      {children}
    </Markdown>
  );
}
