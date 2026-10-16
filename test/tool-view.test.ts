import { createPatch, parsePatch } from "diff";
import { expect, it } from "vitest";

import {
  toolCallView,
  toolPreviewLineLimit,
  type ToolCallSection,
} from "../src/core/tool-view.js";
import type { ToolItem } from "../src/store/types.js";

function call(
  name: string,
  args: ToolItem["args"],
  text?: string,
  isError = false,
): ToolItem {
  const base: ToolItem = {
    args,
    id: "call",
    kind: "tool",
    name,
    startedAt: 1_000,
    status: text === undefined ? "running" : isError ? "error" : "completed",
  };
  return text === undefined
    ? base
    : {
        ...base,
        result: {
          role: "toolResult",
          toolCallId: "call",
          toolName: name,
          content: [{ type: "text", text }],
          isError,
          timestamp: 1_250,
        },
      };
}

function kinds(sections: readonly ToolCallSection[]) {
  return sections.map((section) => section.kind);
}

it("shows a read as a numbered excerpt and nothing else", () => {
  const content = "first\nsecond\n";
  const view = toolCallView(
    call(
      "execute",
      { code: "return await files.read({ path: 'a.ts' });" },
      JSON.stringify({
        path: "a.ts",
        content,
        offset: 0,
        nextOffset: null,
        truncated: false,
      }),
    ),
  );
  expect(kinds(view.sections)).toEqual(["script", "excerpt"]);
  expect(view.sections[1]).toMatchObject({
    lines: [
      { number: 1, text: "first" },
      { number: 2, text: "second" },
    ],
  });
  const read = toolCallView(call("read", { path: "a.ts" }, content));
  expect(read.label).toBe("a.ts");
  expect(kinds(read.sections)).toEqual(["excerpt"]);
  // A page that starts mid-file has no honest line numbers.
  const page = toolCallView(
    call(
      "execute",
      { code: "files.read()" },
      JSON.stringify({ path: "a.ts", content: "x", offset: 90 }),
    ),
  );
  expect(page.sections[1]).toMatchObject({ lines: [{ text: "x" }] });
});

it("lists search hits as location and line", () => {
  const typed = toolCallView(
    call(
      "grep",
      { pattern: "ToolRow", path: "src" },
      JSON.stringify({
        path: "src",
        matches: [
          { path: "src/a.tsx", line: 12, text: "function ToolRow() {" },
        ],
        truncated: false,
      }),
    ),
  );
  expect(typed.sections).toEqual([
    {
      kind: "matches",
      matches: [{ location: "src/a.tsx:12", text: "function ToolRow() {" }],
      preview: toolPreviewLineLimit,
    },
  ]);
  const plain = toolCallView(
    call("grep", { pattern: "x" }, "src/b.ts:3:const x = 1;"),
  );
  expect(plain.sections[0]).toMatchObject({
    matches: [{ location: "src/b.ts:3", text: "const x = 1;" }],
  });
});

it("renders terminal hyperlinks and titles as plain command output", () => {
  const view = toolCallView(
    call(
      "bash",
      { command: "print-links" },
      JSON.stringify({
        exitCode: 0,
        stdout:
          "\u001b]0;Terminal title\u0007See \u001b]8;;https://example.test/docs\u001b\\docs\u001b]8;;\u001b\\\n",
        stderr: "",
      }),
    ),
  );
  expect(view.sections).toContainEqual({
    kind: "output",
    lines: [{ stream: "stdout", text: "See docs" }],
    preview: toolPreviewLineLimit,
  });
});

it("shows a command line, one marked output block, and a non-zero exit code", () => {
  const view = toolCallView(
    call(
      "bash",
      { command: "pnpm test" },
      JSON.stringify({
        exitCode: 1,
        stdout: "\u001b[32m✓\u001b[39m one\n",
        stderr: "✗ two",
        status: "completed",
        truncated: false,
      }),
      true,
    ),
  );
  expect(view.exitCode).toBe(1);
  expect(view.error).toBe("✗ two");
  expect(view.sections).toEqual([
    { kind: "command", lines: ["pnpm test"], preview: 6 },
    {
      kind: "output",
      lines: [
        { stream: "stdout", text: "✓ one" },
        { stream: "stderr", text: "✗ two" },
      ],
      preview: toolPreviewLineLimit,
    },
  ]);
  const ok = toolCallView(
    call(
      "bash",
      { command: "true" },
      JSON.stringify({ exitCode: 0, stdout: "", stderr: "" }),
    ),
  );
  expect(ok.exitCode).toBeUndefined();
  expect(kinds(ok.sections)).toEqual(["command"]);
});

it("shows an edit as its diff only and hides the success envelope", () => {
  const view = toolCallView(
    call(
      "apply_patch",
      {
        patch: [
          "*** Begin Patch",
          "*** Update File: src/a.ts",
          "@@ function main",
          " keep();",
          "-old();",
          "+next();",
          "*** End Patch",
        ].join("\n"),
      },
      JSON.stringify({
        status: "completed",
        exitCode: 0,
        stdout: "Success.",
        stderr: "",
        truncated: false,
      }),
    ),
  );
  expect(view).toMatchObject({ verb: "Updated", label: "src/a.ts" });
  expect(kinds(view.sections)).toEqual(["diff"]);
  expect(view.sections[0]).toMatchObject({
    lines: [
      { kind: "hunk", text: "function main" },
      { kind: "context", text: "keep();" },
      { kind: "remove", text: "old();" },
      { kind: "add", text: "next();" },
    ],
  });
  expect(JSON.stringify(view)).not.toContain("truncated");
});

it("renders a top-level Files edit result from its owner patch without an input diff", () => {
  const unifiedPatch = createPatch("notes.txt", "old\n", "new\n", "", "");
  const result = {
    path: "notes.txt",
    bytes: 4,
    diff: "-1 old\n+1 new",
    firstChangedLine: 1,
    unifiedPatch,
    unifiedPatchBytes: Buffer.byteLength(unifiedPatch),
    unifiedPatchAddedLines: 1,
    unifiedPatchRemovedLines: 1,
    unifiedPatchTruncated: false,
  };
  const view = toolCallView(
    call(
      "execute",
      { code: "return await files.edit(input);" },
      JSON.stringify(result),
    ),
  );
  expect(kinds(view.sections)).toEqual(["script", "diff"]);
  expect(view.sections[1]).toMatchObject({
    files: [{ path: "notes.txt", unified: unifiedPatch, lineNumbers: true }],
  });
  const nested = toolCallView(
    call(
      "execute",
      { code: "return { edit: await files.edit(input) };" },
      JSON.stringify({ edit: result }),
    ),
  );
  expect(kinds(nested.sections)).toEqual(["script", "text"]);
  const large = toolCallView(
    call(
      "execute",
      { code: "return await files.edit(input);" },
      JSON.stringify({
        ...result,
        unifiedPatch: null,
        unifiedPatchBytes: 100_000,
        unifiedPatchTruncated: true,
      }),
    ),
  );
  expect(kinds(large.sections)).toEqual(["script", "text"]);
});

it("computes replacement diffs with jsdiff, rows and unified patch alike", () => {
  const oldText = "a\nb\nc\n";
  const newText = "a\nB\nc\n";
  const view = toolCallView(
    call("edit", { path: "x.ts", oldText, newText }, "ok"),
  );
  const [section] = view.sections;
  if (section?.kind !== "diff") throw new Error("expected a diff");
  const [file] = section.files;
  expect(file?.unified).toBe(createPatch("x.ts", oldText, newText, "", ""));
  expect(file?.lineNumbers).toBe(true);
  expect(section.lines).toEqual([
    { kind: "hunk", text: "-1,3 +1,3" },
    { kind: "context", text: "a" },
    { kind: "remove", text: "b" },
    { kind: "add", text: "B" },
    { kind: "context", text: "c" },
  ]);
});

it("shows a script's source then its output, and other tools' arguments by name", () => {
  const script = toolCallView(call("execute", { code: "return 1 + 1;" }, "2"));
  expect(kinds(script.sections)).toEqual(["script", "text"]);
  const other = toolCallView(call("mcp_lookup", { query: "q" }, "found"));
  expect(other.sections[0]).toMatchObject({ kind: "text", label: "Arguments" });
  expect(other.sections[1]).toMatchObject({ kind: "text", lines: ["found"] });
});

it("puts a failure's message first", () => {
  const view = toolCallView(
    call(
      "execute",
      { code: "boom()" },
      "ReferenceError: boom is not defined",
      true,
    ),
  );
  expect(view.error).toBe("ReferenceError: boom is not defined");
});

it("formats Codex patch hunks as a unified patch jsdiff can read back", () => {
  const view = toolCallView(
    call("apply_patch", {
      patch: [
        "*** Begin Patch",
        "*** Update File: src/a.ts",
        "@@ first",
        "-old();",
        "+next();",
        "@@ second",
        " keep();",
        "+added();",
        "*** Add File: src/new.ts",
        "+export {};",
        "*** End Patch",
      ].join("\n"),
    }),
  );
  const [section] = view.sections;
  if (section?.kind !== "diff") throw new Error("expected a diff");
  expect(section.files.map((file) => file.lineNumbers)).toEqual([false, false]);
  for (const file of section.files) {
    const [parsed] = parsePatch(file.unified);
    expect(parsed?.hunks.map((hunk) => hunk.lines)).toEqual(
      file.hunks.map((hunk) =>
        hunk.lines.map(
          (line) =>
            ({ add: "+", remove: "-", context: " " })[line.kind] + line.text,
        ),
      ),
    );
  }
  expect(section.lines.filter((row) => row.kind === "file")).toEqual([
    { kind: "file", text: "Update src/a.ts" },
    { kind: "file", text: "Add src/new.ts" },
  ]);
});

it("exports the shared tool-kind Sigil vocabulary for native renderers", async () => {
  const headless = await import("../src/headless.js");
  expect(headless).toHaveProperty("toolKindSigils", {
    code: "computer",
    command: "run",
    edit: "write",
    other: "working",
    read: "read",
    search: "search",
  });
});
