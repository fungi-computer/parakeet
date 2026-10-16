import type { SigilName } from "@fungi.computer/sigils";
import {
  parseCodexPatch,
  type CodexPatchFile,
} from "@fungi.computer/knapsack/patch";
import { filesEditFailureSchema } from "@fungi.computer/knapsack";
import {
  formatPatch,
  parsePatch,
  structuredPatch,
  type StructuredPatch,
} from "diff";
import { z } from "zod";
import stripAnsi from "strip-ansi";

import type { ToolItem } from "../store/types.js";
import { reportFailure } from "../lib/failure.js";

/** Shared tool status meaning, used by the browser and native presentations. */
export function toolStatusTone(status: ToolItem["status"]) {
  if (status === "error") return "error";
  if (status === "unknown") return "neutral";
  return status === "running" ? "info" : "success";
}

/**
 * Closed presentation vocabulary for one tool call. It is chosen from the typed
 * tool name, never inferred from arguments or result text.
 */
export type ToolKind =
  "code" | "command" | "edit" | "other" | "read" | "search";

/** Shared artwork identity for browser and native tool rows. */
export const toolKindSigils = {
  /** Artwork for code execution. */
  code: "computer",
  /** Artwork for shell commands. */
  command: "run",
  /** Artwork for file edits. */
  edit: "write",
  /** Artwork for other tool calls. */
  other: "working",
  /** Artwork for file reads. */
  read: "read",
  /** Artwork for search results. */
  search: "search",
} as const satisfies Record<ToolKind, SigilName>;

/** One changed or context line of a diff hunk. */
export type ToolDiffLine = Readonly<{
  /** Line role. */
  kind: "add" | "context" | "remove";
  /** Line text without its diff marker. */
  text: string;
}>;

/** One hunk: a jsdiff hunk, or one `@@` block of a Codex patch. */
export type ToolDiffHunk = Readonly<{
  /** `-a,b +c,d` for computed hunks; the `@@` context for patch hunks. */
  header?: string | undefined;
  /** Hunk lines in order. */
  lines: readonly ToolDiffLine[];
}>;

/** The hunks for one file. */
export type ToolDiffFile = Readonly<{
  /** File operation. */
  operation: "add" | "delete" | "update";
  /** File path, when known. */
  path?: string | undefined;
  /** Destination of a move. */
  moveTo?: string | undefined;
  /** Hunks in file order. */
  hunks: readonly ToolDiffHunk[];
  /**
   * The same hunks as one unified patch, formatted by jsdiff, for renderers
   * that draw unified diffs (OpenTUI's diff view).
   */
  unified: string;
  /**
   * Whether hunk line numbers are real. Codex patch hunks carry no numbers,
   * so their unified form numbers each hunk from 1 and renderers hide them.
   */
  lineNumbers: boolean;
}>;

/**
 * One display row of a diff, flattened once here so every renderer draws the
 * same rows. File rows appear only when a call touches several files.
 */
export type ToolDiffRow = Readonly<{
  /** Row role. */
  kind: "add" | "context" | "file" | "hunk" | "remove";
  /** Row text without a marker. */
  text: string;
}>;

/** One file excerpt line; the number is present only when it is known. */
export type ToolExcerptLine = Readonly<{
  /** One-based line number in the file. */
  number?: number | undefined;
  /** Line text. */
  text: string;
}>;

/** One search hit. */
export type ToolMatch = Readonly<{
  /** `path:line` of the hit. */
  location: string;
  /** Matched line text. */
  text: string;
}>;

/** One line of command output, marked by the stream that produced it. */
export type ToolOutputLine = Readonly<{
  /** Producing stream. */
  stream: "stderr" | "stdout";
  /** Line text without ANSI sequences. */
  text: string;
}>;

/**
 * One typed section of an expanded call body. Sections hold complete bounded
 * content; renderers show `preview` items and offer the rest.
 */
export type ToolCallSection = Readonly<
  | {
      /** File excerpt. */
      kind: "excerpt";
      /** Excerpt lines, in file order. */
      lines: readonly ToolExcerptLine[];
      /** Items shown before "more". */
      preview: number;
    }
  | {
      /** Search hits. */
      kind: "matches";
      /** Hits, in result order. */
      matches: readonly ToolMatch[];
      /** Items shown before "more". */
      preview: number;
    }
  | {
      /** Edit diff: structured files and their flattened display rows. */
      kind: "diff";
      /** Structured hunks per file. */
      files: readonly ToolDiffFile[];
      /** Flattened display rows for every file. */
      lines: readonly ToolDiffRow[];
      /** Items shown before "more". */
      preview: number;
    }
  | {
      /** The command line, drawn as `$ <command>`. */
      kind: "command";
      /** Text lines. */
      lines: readonly string[];
      /** Items shown before "more". */
      preview: number;
    }
  | {
      /** Script source. */
      kind: "script";
      /** Text lines. */
      lines: readonly string[];
      /** Items shown before "more". */
      preview: number;
    }
  | {
      /** Command output with stderr lines marked. */
      kind: "output";
      /** Output lines, stdout before stderr. */
      lines: readonly ToolOutputLine[];
      /** Items shown before "more". */
      preview: number;
    }
  | {
      /** Plain or JSON text with a human label, e.g. `Arguments`. */
      kind: "text";
      /** Human label, e.g. `Arguments`. */
      label?: string | undefined;
      /** Highlighting hint. */
      language?: "json" | undefined;
      /** Text lines. */
      lines: readonly string[];
      /** Items shown before "more". */
      preview: number;
    }
>;

/** Renderer-neutral presentation of one tool call and its joined result. */
export type ToolCallView = Readonly<{
  /** Tool-call identity. */
  id: string;
  /** Typed tool kind. */
  kind: ToolKind;
  /** Pi tool name. */
  name: string;
  /** Past-tense verb for the finished call, e.g. `Read`. */
  verb: string;
  /** Present-tense verb for the running call, e.g. `Reading`. */
  activeVerb: string;
  /** Short one-line target: a path, command, pattern, or first code line. */
  label: string;
  /** Distinct file paths this call reads or edits, when known. */
  paths: readonly string[];
  /** Call activity. */
  status: ToolItem["status"];
  /** Milliseconds from the call to its result, when both are known. */
  durationMs?: number | undefined;
  /** A non-zero process exit code, for a header chip. */
  exitCode?: number | undefined;
  /** The failure message, shown before the body, for failed calls. */
  error?: string | undefined;
  /** Expanded body sections, in display order. */
  sections: readonly ToolCallSection[];
}>;

/** Items shown before "more" for excerpts, matches, and output. */
export const toolPreviewLineLimit = 12;
/** Diff lines shown before "more". */
const toolDiffPreviewLimit = 40;
/** Script lines shown before "more". */
const toolScriptPreviewLimit = 6;
/** Hard bound on any one section, independent of preview. */
const toolSectionLimit = 400;
const labelLimit = 72;

const kindByName = new Map<string, ToolKind>([
  ["apply_patch", "edit"],
  ["bash", "command"],
  ["edit", "edit"],
  ["execute", "code"],
  ["find", "search"],
  ["grep", "search"],
  ["ls", "search"],
  ["read", "read"],
  ["write", "edit"],
]);

const verbs = {
  code: ["Ran script", "Running script"],
  command: ["Ran", "Running"],
  edit: ["Updated", "Updating"],
  other: ["Called", "Calling"],
  read: ["Read", "Reading"],
  search: ["Searched", "Searching"],
} as const satisfies Record<ToolKind, readonly [string, string]>;

const pathArgs = z.looseObject({ path: z.string() });
const filePathArgs = z.looseObject({ file_path: z.string() });
const commandArgs = z.looseObject({ command: z.string() });
const codeArgs = z.looseObject({ code: z.string() });
const patchArgs = z.looseObject({ patch: z.string() });
const patternArgs = z.looseObject({ pattern: z.string() });
const editArgs = z.looseObject({ oldText: z.string(), newText: z.string() });
const writeArgs = z.looseObject({ content: z.string() });
const jsonText = z.string();

/** Knapsack Files read page; `offset` is a byte offset. */
const readResult = z.looseObject({
  content: z.string(),
  offset: z.number().int().min(0).optional(),
});
/** Knapsack Files grep result. */
const grepResult = z.looseObject({
  matches: z.array(
    z.looseObject({
      path: z.string(),
      line: z.number().int(),
      text: z.string(),
    }),
  ),
});
/** Process output shared by shell tools and the Files patch engine. */
const processResult = z
  .looseObject({
    stdout: z.string().optional(),
    stderr: z.string().optional(),
    exitCode: z.number().int().nullable().optional(),
  })
  .refine(
    (value) =>
      value.stdout !== undefined ||
      value.stderr !== undefined ||
      value.exitCode !== undefined,
  );
const filesEditResult = z.strictObject({
  path: z.string(),
  bytes: z.number().int().nonnegative(),
  diff: z.string(),
  firstChangedLine: z.number().int().positive().nullable(),
  unifiedPatch: z.string().nullable(),
  unifiedPatchBytes: z.number().int().nonnegative(),
  unifiedPatchAddedLines: z.number().int().nonnegative(),
  unifiedPatchRemovedLines: z.number().int().nonnegative(),
  unifiedPatchTruncated: z.boolean(),
});
/** Plain-text grep hit: `path:line:text` or `path:line- text`. */
const hitPattern = /^(.+?:\d+)[:-]\s?(.*)$/u;

/** Typed kind for one Pi tool name. */
function toolKind(name: string): ToolKind {
  return kindByName.get(name) ?? "other";
}

function firstLine(text: string): string {
  const line =
    text
      .split("\n")
      .map((candidate) => candidate.trim())
      .find((candidate) => candidate !== "") ?? "";
  return line.length > labelLimit ? `${line.slice(0, labelLimit - 1)}…` : line;
}

function bounded<T>(items: readonly T[]): T[] {
  return items.slice(0, toolSectionLimit);
}

function textLines(text: string): string[] {
  return bounded(stripAnsi(text).replace(/\n$/u, "").split("\n"));
}

function argumentPath(args: ToolItem["args"]): string | undefined {
  const path = pathArgs.safeParse(args);
  if (path.success) return path.data.path;
  const filePath = filePathArgs.safeParse(args);
  return filePath.success ? filePath.data.file_path : undefined;
}

/** The joined result as text, a decoded JSON string, or parsed JSON. */
type ResultValue =
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "text"; text: string }>
  | Readonly<{ kind: "json"; value: z.infer<ReturnType<typeof z.json>> }>;

type JsonText =
  | Readonly<{ kind: "parsed"; value: unknown }>
  | Readonly<{ kind: "invalid"; cause: unknown }>;

function parseJsonText(text: string): JsonText {
  try {
    return { kind: "parsed", value: JSON.parse(text) };
  } catch (cause) {
    return { kind: "invalid", cause };
  }
}

function resultValue(result: ToolItem["result"]): ResultValue {
  if (result === undefined) return { kind: "none" };
  const text = result.content
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n");
  if (text.trim() === "") return { kind: "none" };
  const parsed = parseJsonText(text);
  if (parsed.kind === "invalid") return { kind: "text", text };
  const json = parsed.value;
  const string = jsonText.safeParse(json);
  if (string.success) return { kind: "text", text: string.data };
  const value = z.json().safeParse(json);
  return value.success
    ? { kind: "json", value: value.data }
    : { kind: "text", text };
}

function excerpt(content: string, offset: number | undefined): ToolCallSection {
  const numbered = offset === undefined || offset === 0;
  return {
    kind: "excerpt",
    lines: textLines(content).map((text, index) =>
      numbered ? { number: index + 1, text } : { text },
    ),
    preview: toolPreviewLineLimit,
  };
}

function matchesFromText(text: string): ToolCallSection {
  return {
    kind: "matches",
    matches: textLines(text)
      .filter((line) => line.trim() !== "")
      .map((line) => {
        const hit = hitPattern.exec(line);
        return hit === null
          ? { location: "", text: line }
          : { location: hit[1] ?? "", text: hit[2] ?? "" };
      }),
    preview: toolPreviewLineLimit,
  };
}

function outputSection(
  stdout: string | undefined,
  stderr: string | undefined,
): ToolCallSection | undefined {
  const lines: ToolOutputLine[] = [];
  if (stdout !== undefined && stdout.trim() !== "")
    for (const text of textLines(stdout))
      lines.push({ stream: "stdout", text });
  if (stderr !== undefined && stderr.trim() !== "")
    for (const text of textLines(stderr))
      lines.push({ stream: "stderr", text });
  return lines.length === 0
    ? undefined
    : { kind: "output", lines: bounded(lines), preview: toolPreviewLineLimit };
}

function jsonSection(
  value: ToolItem["args"] | z.infer<ReturnType<typeof z.json>>,
  label?: string,
): ToolCallSection {
  return {
    kind: "text",
    label,
    language: "json",
    lines: textLines(JSON.stringify(value, null, 2)),
    preview: toolPreviewLineLimit,
  };
}

type ResultBody = Readonly<{
  sections: ToolCallSection[];
  exitCode?: number | undefined;
  /** First meaningful failure text, when the result carries one. */
  failure?: string | undefined;
}>;

/**
 * Recognize the typed result shapes (Files read and grep pages, process
 * output) and drop success envelopes; anything else is shown as-is.
 */
function resultBody(value: ResultValue, kind: ToolKind): ResultBody {
  if (value.kind === "none") return { sections: [] };
  if (value.kind === "text") {
    if (kind === "read") return { sections: [excerpt(value.text, undefined)] };
    if (kind === "search") return { sections: [matchesFromText(value.text)] };
    if (kind === "command") {
      const output = outputSection(value.text, undefined);
      return {
        failure: firstLine(value.text),
        sections: output === undefined ? [] : [output],
      };
    }
    return {
      failure: firstLine(value.text),
      sections: [
        {
          kind: "text",
          lines: textLines(value.text),
          preview: toolPreviewLineLimit,
        },
      ],
    };
  }
  const read = readResult.safeParse(value.value);
  if (read.success)
    return { sections: [excerpt(read.data.content, read.data.offset)] };
  const grep = grepResult.safeParse(value.value);
  if (grep.success)
    return {
      sections: [
        {
          kind: "matches",
          matches: bounded(grep.data.matches).map((match) => ({
            location: `${match.path}:${String(match.line)}`,
            text: stripAnsi(match.text),
          })),
          preview: toolPreviewLineLimit,
        },
      ],
    };
  const editFailure = filesEditFailureSchema.safeParse(value.value);
  if (editFailure.success)
    return {
      failure: editFailure.data.error.message,
      sections: [
        {
          kind: "text",
          lines: [editFailure.data.error.message],
          preview: toolPreviewLineLimit,
        },
      ],
    };
  const edit = filesEditResult.safeParse(value.value);
  if (edit.success) {
    const { unifiedPatch, unifiedPatchBytes, unifiedPatchTruncated } =
      edit.data;
    if (unifiedPatchTruncated && unifiedPatch === null)
      return {
        sections: [
          {
            kind: "text",
            lines: [
              `Diff omitted (${String(unifiedPatchBytes)} bytes, ${String(edit.data.unifiedPatchAddedLines)} added, ${String(edit.data.unifiedPatchRemovedLines)} removed).`,
            ],
            preview: toolPreviewLineLimit,
          },
        ],
      };
    if (
      !unifiedPatchTruncated &&
      unifiedPatch !== null &&
      unifiedPatchBytes <= 65_536 &&
      new TextEncoder().encode(unifiedPatch).byteLength === unifiedPatchBytes
    ) {
      try {
        const parsed = parsePatch(unifiedPatch);
        const file = parsed[0];
        if (
          parsed.length === 1 &&
          file?.oldFileName === edit.data.path &&
          file.newFileName === edit.data.path
        ) {
          return {
            sections: [
              diffSection([
                {
                  operation: "update",
                  path: edit.data.path,
                  moveTo: undefined,
                  lineNumbers: true,
                  unified: unifiedPatch,
                  hunks: file.hunks.map((hunk) => ({
                    header: `-${String(hunk.oldStart)},${String(hunk.oldLines)} +${String(hunk.newStart)},${String(hunk.newLines)}`,
                    lines: hunk.lines.flatMap((line) => {
                      const kind = diffMarkers.get(line.charAt(0));
                      return kind === undefined
                        ? []
                        : [{ kind, text: line.slice(1) }];
                    }),
                  })),
                },
              ]),
            ],
          };
        }
      } catch (cause) {
        reportFailure("render tool patch", cause);
      }
    }
  }
  const process = processResult.safeParse(value.value);
  if (process.success) {
    const { stdout, stderr, exitCode } = process.data;
    const output = outputSection(stdout, stderr);
    const failed =
      exitCode !== undefined && exitCode !== null && exitCode !== 0;
    return {
      exitCode: failed ? exitCode : undefined,
      failure:
        stderr !== undefined && stderr.trim() !== ""
          ? firstLine(stripAnsi(stderr))
          : failed
            ? `Exited with code ${String(exitCode)}`
            : undefined,
      sections: output === undefined ? [] : [output],
    };
  }
  return { sections: [jsonSection(value.value)] };
}

type CallTarget = Readonly<{
  label: string;
  paths: readonly string[];
  /** Sections drawn from the call's own input, before the result. */
  input: readonly ToolCallSection[];
}>;

const operationLabels = {
  add: "Add",
  delete: "Delete",
  update: "Update",
} as const satisfies Record<ToolDiffFile["operation"], string>;

function diffRows(files: readonly ToolDiffFile[]): ToolDiffRow[] {
  const named = files.length > 1;
  return files.flatMap((file) => [
    ...(named
      ? [
          {
            kind: "file" as const,
            text: `${operationLabels[file.operation]} ${file.path ?? ""}${
              file.moveTo === undefined ? "" : ` → ${file.moveTo}`
            }`,
          },
        ]
      : []),
    ...file.hunks.flatMap((hunk) => [
      ...(hunk.header === undefined
        ? []
        : [{ kind: "hunk" as const, text: hunk.header }]),
      ...hunk.lines,
    ]),
  ]);
}

function diffSection(files: readonly ToolDiffFile[]): ToolCallSection {
  return {
    kind: "diff",
    files,
    lines: bounded(diffRows(files)),
    preview: toolDiffPreviewLimit,
  };
}

const markerByKind = {
  add: "+",
  context: " ",
  remove: "-",
} as const satisfies Record<ToolDiffLine["kind"], string>;

/** Codex patch files, read by Knapsack's owner-side grammar reader. */
function patchFiles(patch: readonly CodexPatchFile[]): ToolDiffFile[] {
  return patch.map((file) => {
    // No real line numbers exist; number hunks consecutively so the unified
    // form stays well-formed, and mark it so renderers hide the numbers.
    let oldStart = 1;
    let newStart = 1;
    const hunks = file.hunks.map((hunk) => {
      const count = (kind: ToolDiffLine["kind"]) =>
        hunk.lines.filter((line) => line.kind === kind).length;
      const oldLines = count("context") + count("remove");
      const newLines = count("context") + count("add");
      const numbered = {
        oldStart,
        oldLines,
        newStart,
        newLines,
        lines: hunk.lines.map(
          (line) => `${markerByKind[line.kind]}${line.text}`,
        ),
      };
      oldStart += oldLines;
      newStart += newLines;
      return numbered;
    });
    const structured: StructuredPatch = {
      oldFileName: file.path,
      newFileName: file.moveTo ?? file.path,
      oldHeader: undefined,
      newHeader: undefined,
      hunks,
    };
    return {
      hunks: file.hunks.map((hunk) => ({
        header: hunk.context,
        lines: hunk.lines,
      })),
      lineNumbers: false,
      moveTo: file.moveTo,
      operation: file.operation,
      path: file.path,
      unified: structured.hunks.length === 0 ? "" : formatPatch(structured),
    };
  });
}

const diffMarkers = new Map<string, ToolDiffLine["kind"]>([
  ["+", "add"],
  ["-", "remove"],
  [" ", "context"],
]);

/** Line diff of a replacement, computed by jsdiff. */
function replacementFile(
  path: string | undefined,
  oldText: string,
  newText: string,
): ToolDiffFile {
  const name = path ?? "file";
  const patch = structuredPatch(name, name, oldText, newText, "", "", {
    context: 3,
  });
  return {
    lineNumbers: true,
    unified: formatPatch(patch),
    hunks: patch.hunks.map((hunk) => ({
      header: `-${String(hunk.oldStart)},${String(hunk.oldLines)} +${String(hunk.newStart)},${String(hunk.newLines)}`,
      lines: hunk.lines.flatMap((line) => {
        const kind = diffMarkers.get(line.charAt(0));
        return kind === undefined ? [] : [{ kind, text: line.slice(1) }];
      }),
    })),
    operation: oldText === "" ? "add" : "update",
    path,
  };
}

function editTarget(item: ToolItem, path: string | undefined): CallTarget {
  const patch = patchArgs.safeParse(item.args);
  if (patch.success) {
    const parsed = parseCodexPatch(patch.data.patch);
    const paths = [
      ...new Set(parsed.flatMap((file) => (file.path ? [file.path] : []))),
    ];
    const label =
      paths.length <= 1
        ? (paths[0] ?? item.name)
        : `${paths[0] ?? ""} +${String(paths.length - 1)}`;
    return {
      get input() {
        return [diffSection(patchFiles(parsed))];
      },
      label,
      paths,
    };
  }
  const target = {
    label: path ?? item.name,
    paths: path === undefined ? [] : [path],
  };
  const edit = editArgs.safeParse(item.args);
  if (edit.success)
    return {
      ...target,
      get input() {
        return [
          diffSection([
            replacementFile(path, edit.data.oldText, edit.data.newText),
          ]),
        ];
      },
    };
  const write = writeArgs.safeParse(item.args);
  return {
    ...target,
    get input() {
      return write.success
        ? [diffSection([replacementFile(path, "", write.data.content)])]
        : [];
    },
  };
}

/** Arguments that miss the tool's typed shape are shown as they are. */
function untypedTarget(item: ToolItem): CallTarget {
  return {
    get input() {
      return Object.keys(item.args).length === 0
        ? []
        : [jsonSection(item.args, "Arguments")];
    },
    label: item.name,
    paths: [],
  };
}

function callTarget(item: ToolItem, kind: ToolKind): CallTarget {
  const path = argumentPath(item.args);
  switch (kind) {
    case "code": {
      const code = codeArgs.safeParse(item.args);
      return code.success
        ? {
            get input() {
              return [
                {
                  kind: "script" as const,
                  lines: textLines(code.data.code),
                  preview: toolScriptPreviewLimit,
                },
              ];
            },
            label: firstLine(code.data.code),
            paths: [],
          }
        : untypedTarget(item);
    }
    case "command": {
      const command = commandArgs.safeParse(item.args);
      return command.success
        ? {
            get input() {
              return [
                {
                  kind: "command" as const,
                  lines: textLines(command.data.command),
                  preview: toolScriptPreviewLimit,
                },
              ];
            },
            label: firstLine(command.data.command),
            paths: [],
          }
        : untypedTarget(item);
    }
    case "edit":
      return editTarget(item, path);
    case "read":
      return {
        input: [],
        label: path ?? item.name,
        paths: path === undefined ? [] : [path],
      };
    case "search": {
      const pattern = patternArgs.safeParse(item.args);
      const label = pattern.success
        ? path === undefined
          ? pattern.data.pattern
          : `${pattern.data.pattern} in ${path}`
        : (path ?? ".");
      return { input: [], label: firstLine(label), paths: [] };
    }
    case "other":
      return untypedTarget(item);
  }
}

/** Build the renderer-neutral view of one call. */
export function toolCallView(item: ToolItem): ToolCallView {
  const kind = toolKind(item.name);
  const target = callTarget(item, kind);
  const [verb, activeVerb] = verbs[kind];
  // A Files edit refusal can arrive inside a successful execute result and
  // must set the group status before its body is opened.
  const statusValue =
    item.status === "completed" ? resultValue(item.result) : undefined;
  const refused =
    statusValue?.kind === "json" &&
    filesEditFailureSchema.safeParse(statusValue.value).success;
  // Most completed tools are collapsed. Decode their potentially large result
  // body and diff only when a visible renderer asks for those fields. Failed
  // edits still inspect the result here because their status can be encoded in
  // a successful transport envelope.
  let details:
    | Readonly<{
        error: string | undefined;
        exitCode: number | undefined;
        sections: readonly ToolCallSection[];
      }>
    | undefined;
  const getDetails = () => {
    if (details !== undefined) return details;
    const value = resultValue(item.result);
    const body = resultBody(value, kind);
    const failed = item.status === "error" || refused;
    const error = failed
      ? (body.failure ?? "The tool reported an error.")
      : undefined;
    const resultHasDiff = body.sections.some(
      (section) => section.kind === "diff",
    );
    const resultSections = (
      kind === "edit" && !failed && !resultHasDiff ? [] : body.sections
    ).filter(
      (section) =>
        !(
          section.kind === "text" &&
          section.lines.length === 1 &&
          section.lines[0] === error
        ),
    );
    details = {
      error,
      exitCode: body.exitCode,
      sections: [
        ...(kind === "edit" && resultHasDiff ? [] : target.input),
        ...resultSections,
      ],
    };
    return details;
  };
  const failed = item.status === "error" || refused;
  return {
    activeVerb,
    durationMs:
      item.startedAt === undefined || item.result === undefined
        ? undefined
        : Math.max(0, item.result.timestamp - item.startedAt),
    get error() {
      return failed ? getDetails().error : undefined;
    },
    get exitCode() {
      return getDetails().exitCode;
    },
    id: item.id,
    kind,
    label: target.label,
    name: item.name,
    paths: target.paths,
    get sections() {
      return getDetails().sections;
    },
    status: failed ? "error" : item.status,
    verb,
  };
}

/** Compact duration: `340ms`, `1.2s`, `2m 5s`. */
export function formatToolDuration(milliseconds: number): string {
  if (milliseconds < 1_000) return `${String(Math.round(milliseconds))}ms`;
  if (milliseconds < 60_000) return `${(milliseconds / 1_000).toFixed(1)}s`;
  const seconds = Math.round(milliseconds / 1_000);
  return `${String(Math.floor(seconds / 60))}m ${String(seconds % 60)}s`;
}
