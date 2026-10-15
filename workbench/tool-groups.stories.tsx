import { nanoid } from "@fungi.computer/cairn";
import type { StoryDefault } from "@ladle/react";
import type { SessionMessage } from "@fungi.computer/shiitake/client";
import { useState } from "react";

import { TimelineItem } from "../src/components/TimelineItem.js";
import { buildDurableTimeline } from "../src/core/build-timeline.js";
import type { ToolArguments } from "../src/core/tool-contract.js";
import {
  initialToolDisclosure,
  toggleDisclosure,
  type ToolDisclosureState,
} from "../src/core/tool-groups.js";
import "@fungi.computer/parakeet/styles.css";

export default { title: "Parakeet / Tool groups" } satisfies StoryDefault;

const usage = {
  input: 1,
  output: 1,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 2,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

/** One typed tool call and the result the Session will join to it. */
type FixtureCall = Readonly<{
  id: string;
  name: string;
  arguments: ToolArguments;
  output?: string;
  isError?: boolean;
  elapsed?: number;
}>;

const readFrame: FixtureCall = {
  id: "read-frame",
  name: "read",
  arguments: { path: "apps/tui/src/frame.tsx" },
  output: JSON.stringify({
    path: "apps/tui/src/frame.tsx",
    offset: 0,
    content: Array.from(
      { length: 30 },
      (_, index) => `export const line${String(index + 1)} = ${String(index)};`,
    ).join("\n"),
  }),
  elapsed: 42,
};
const readTranscript: FixtureCall = {
  id: "read-transcript",
  name: "read",
  arguments: { path: "apps/tui/src/transcript.tsx" },
  output: "export const TerminalTranscript = memo(TerminalTranscriptView);",
  elapsed: 38,
};
const grep: FixtureCall = {
  id: "grep-tool-row",
  name: "grep",
  arguments: { pattern: "ToolRow", path: "apps/tui/src" },
  output: "apps/tui/src/transcript.tsx:121: function ToolRow({",
  elapsed: 120,
};
const patch: FixtureCall = {
  id: "patch-transcript",
  name: "apply_patch",
  arguments: {
    patch: [
      "*** Begin Patch",
      "*** Update File: apps/tui/src/transcript.tsx",
      "@@ function ToolRow({",
      "   const { colors } = presentation;",
      "-  const tone = colors.info;",
      "+  const tone = statusTone(item.status, presentation);",
      "   return (",
      "*** End Patch",
    ].join("\n"),
  },
  output: JSON.stringify({
    status: "completed",
    exitCode: 0,
    stdout:
      "Success. Updated the following files:\nM apps/tui/src/transcript.tsx",
    stderr: "",
    truncated: false,
  }),
  elapsed: 310,
};
const failingTest: FixtureCall = {
  id: "test-tui",
  name: "bash",
  arguments: { command: "pnpm --dir apps/tui run test" },
  output: JSON.stringify({
    exitCode: 1,
    stdout: Array.from(
      { length: 18 },
      (_, index) => `✓ transcript row ${String(index + 1)}`,
    ).join("\n"),
    stderr: "✗ groups fold consecutive calls\n  expected 1 group, received 2",
  }),
  isError: true,
  elapsed: 4_200,
};
const typecheck: FixtureCall = {
  id: "typecheck-tui",
  name: "bash",
  arguments: { command: "pnpm --dir apps/tui run typecheck" },
  output: "tsc -p tsconfig.json --noEmit",
  elapsed: 2_900,
};
const script: FixtureCall = {
  id: "script-render",
  name: "execute",
  arguments: {
    code: "const frame = await terminal.render({ width: 48, height: 18 });\nreturn frame.lines.length;",
  },
  output: "18",
  elapsed: 860,
};

/** Assistant prose, or one call followed by its joined result. */
type Step =
  | Readonly<{ kind: "text"; text: string }>
  | Readonly<{ kind: "call"; call: FixtureCall }>;

const say = (text: string): Step => ({ kind: "text", text });
const run = (call: FixtureCall): Step => ({ kind: "call", call });

function conversation(
  steps: readonly Step[],
  running?: FixtureCall,
): SessionMessage[] {
  const messages: SessionMessage[] = [];
  let sequence = 0;
  const next = () => {
    sequence += 1;
    return sequence;
  };
  const assistant = (
    content: Extract<SessionMessage["value"], { role: "assistant" }>["content"],
  ): SessionMessage => {
    const at = next();
    return {
      id: `assistant-${String(at)}`,
      commandId: null,
      sequence: at,
      value: {
        role: "assistant",
        api: "pi",
        provider: "camel",
        model: "auto",
        content,
        stopReason: "toolUse",
        timestamp: at * 10_000,
        usage,
      },
    };
  };
  for (const step of steps) {
    if (step.kind === "text") {
      messages.push(assistant([{ type: "text", text: step.text }]));
      continue;
    }
    const tool = step.call;
    const issued = assistant([
      {
        type: "toolCall",
        id: tool.id,
        name: tool.name,
        arguments: tool.arguments,
      },
    ]);
    const at = next();
    messages.push(issued, {
      id: `result-${tool.id}`,
      commandId: null,
      sequence: at,
      value: {
        role: "toolResult",
        toolCallId: tool.id,
        toolName: tool.name,
        content: [{ type: "text", text: tool.output ?? "" }],
        isError: tool.isError ?? false,
        timestamp: issued.sequence * 10_000 + (tool.elapsed ?? 100),
      },
    });
  }
  if (running !== undefined)
    messages.push(
      assistant([
        {
          type: "toolCall",
          id: running.id,
          name: running.name,
          arguments: running.arguments,
        },
      ]),
    );
  return messages;
}

function Timeline({
  messages,
  initial = initialToolDisclosure,
}: Readonly<{
  messages: readonly SessionMessage[];
  initial?: ToolDisclosureState;
}>) {
  const [items] = useState(() => buildDurableTimeline(messages).items);
  const [disclosure, setDisclosure] = useState(initial);
  return (
    <div
      className="parakeet prose mx-auto w-full py-md"
      data-testid="tool-groups-story"
    >
      {items.map((item) => (
        <div data-parakeet-entry={item.kind} key={item.id}>
          <TimelineItem
            item={item}
            onToggleTool={(id, defaultOpen) => {
              setDisclosure((current) =>
                toggleDisclosure(current, id, defaultOpen),
              );
            }}
            toolDisclosure={disclosure}
          />
        </div>
      ))}
    </div>
  );
}

const intro = "I’ll read the transcript, patch it, then run the checks.";
const outro =
  "The typecheck passes. One test failed; I’ll fix the assertion next.";

/** Finished run of mixed kinds: collapsed to one summary line. */
export const Done = () => (
  <Timeline
    messages={conversation([
      say(intro),
      ...[readFrame, readTranscript, grep, patch, typecheck].map(run),
      say("Both checks pass."),
    ])}
  />
);

/** Collapsed on the live line of the running call. */
export const Running = () => (
  <Timeline
    messages={conversation(
      [say(intro), ...[readFrame, readTranscript, patch].map(run)],
      typecheck,
    )}
  />
);

/** A failure opens the group on the failed call. */
export const Failed = () => (
  <Timeline
    messages={conversation([
      say(intro),
      ...[readFrame, readTranscript, grep, patch, failingTest, typecheck].map(
        run,
      ),
      say(outro),
    ])}
  />
);

/** Every call kind expanded: read, search, edit diff, command, script, failure. */
export const ExpandedKinds = () => (
  <Timeline
    initial={{
      mode: "default",
      overrides: new Map([
        ["tools:read-frame", true],
        ["read-frame", true],
        ["grep-tool-row", true],
        ["patch-transcript", true],
        ["script-render", true],
        ["typecheck-tui", true],
      ]),
    }}
    messages={conversation([
      say(intro),
      ...[readFrame, grep, patch, typecheck, script, failingTest].map(run),
      say(outro),
    ])}
  />
);

/** A long run still reads as one bounded line. */
export const ManyCalls = () => (
  <Timeline
    messages={conversation([
      say("Auditing every transcript file."),
      ...Array.from({ length: 60 }, (_, index): FixtureCall => {
        const kind = index % 3;
        if (kind === 0)
          return {
            ...readFrame,
            id: nanoid(),
            arguments: { path: `apps/tui/src/file-${String(index)}.tsx` },
          };
        if (kind === 1) return { ...grep, id: nanoid() };
        return { ...typecheck, id: nanoid() };
      }).map(run),
      say("Audit complete."),
    ])}
  />
);

/** A lone call is a group of one, labelled by its target. */
export const LoneCall = () => (
  <Timeline
    messages={conversation([
      say("Checking one file."),
      run(readTranscript),
      say("Found it."),
    ])}
  />
);
