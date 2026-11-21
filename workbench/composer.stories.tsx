import type { Story, StoryDefault } from "@ladle/react";
import { awaitingFixtures } from "@fungi.computer/parakeet-testing";
import { createWhistleInteractionHost } from "@fungi.computer/whistle/interaction";
import type { PromptCommand } from "@fungi.computer/shiitake/client";
import { useMemo, useRef, useState } from "react";

import type { SlashCommandController } from "../src/commands/use-slash-commands.js";
import { createParakeetInteractions } from "../src/commands/interactions.js";
import {
  ChatComposer,
  type ChatComposerProps,
} from "../src/components/ChatComposer.js";
import { TimelineItem } from "../src/components/TimelineItem.js";
import {
  awaitingQueue,
  type AwaitingItem,
} from "../src/core/awaiting-answer.js";
import type { TimelineItem as TimelineRow } from "../src/store/types.js";
import { approvalCardCopy } from "../src/core/approval-decision.js";
import "@fungi.computer/parakeet/styles.css";

export default { title: "Parakeet / Composer" } satisfies StoryDefault;

const start = Date.UTC(2026, 9, 27, 10, 24, 0);

const turns: readonly TimelineRow[] = [
  {
    id: "ask",
    kind: "user_message",
    status: "confirmed",
    at: start,
    text: "Set up note storage for the garden app.",
  },
  {
    id: "answer",
    kind: "assistant_message",
    pending: false,
    at: start + 6_000,
    thinking: "",
    text: "I can wire this up two ways, so I need a few decisions from you before I write any code.",
  },
];

/** Two tiny swatches drawn at runtime, standing in for pasted screenshots. */
function swatches(): NonNullable<PromptCommand["images"]> {
  const paint = (from: string, to: string) => {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext("2d");
    if (context !== null) {
      const fill = context.createLinearGradient(0, 0, 64, 64);
      fill.addColorStop(0, from);
      fill.addColorStop(1, to);
      context.fillStyle = fill;
      context.fillRect(0, 0, 64, 64);
    }
    return {
      type: "image" as const,
      mimeType: "image/png",
      data: canvas
        .toDataURL("image/png")
        .replace(/^data:image\/png;base64,/u, ""),
    };
  };
  return [paint("#7fb77e", "#2f6f4f"), paint("#f2b880", "#c8553d")];
}

/** A real Whistle host holding one fixture decision, as the composer receives it. */
/** An App's write card, worded by the real approval copy from the method's own label. */
function appWriteApproval(): Pick<
  (typeof awaitingFixtures)[number],
  "kind" | "prompt"
> {
  const card = approvalCardCopy(
    {
      record: {
        recordId: "approval-1",
        revision: 1,
        requester: {
          displayName: "Shiitake",
          agentId: "agent-1",
          sessionId: "session-1",
          principalId: "agent-1",
        },
        module: "attachment-1",
        operation: "writeFile",
        access: "write",
        description: {
          app: {
            displayName: "Inkcap",
            operationLabel: "Save a file on your Computer",
          },
          inputBytes: 412,
          inputSha256: "0".repeat(64),
        },
        reversibility: "reversible",
        expiresAt: start + 600_000,
      },
      canAnswer: true,
    },
    undefined,
    { width: 60, home: "/home/you", now: start },
  );
  return {
    kind: "approval",
    prompt: {
      type: "decision",
      message: card.content.title,
      summary: card.content.summary ?? "",
      facts: [...(card.content.facts ?? [])],
      options: [
        { value: "approve", label: "Approve once" },
        { value: "deny", label: "Deny" },
      ],
      other: {
        label: "Deny and say why…",
        placeholder: "A short reason for the Agent (optional)",
        maxLength: 512,
        blank: "deny",
      },
    },
  };
}

function waitingDecision(name: string): AwaitingItem {
  const fixture =
    name === "approval app write"
      ? appWriteApproval()
      : awaitingFixtures.find((entry) => entry.name === name);
  if (fixture === undefined) throw new Error(`No awaiting fixture ${name}`);
  const host = createWhistleInteractionHost({ title: fixture.prompt.message });
  void host.begin().interaction.prompt(fixture.prompt);
  return { key: name, kind: fixture.kind, arrivedAt: start, host };
}

/** The Session's own commands behind the toolbar keys, as a host registers them. */
const registered = new Set(["model", "thinking", "compact"]);

function slashFor(item: AwaitingItem | undefined): SlashCommandController {
  const store = createParakeetInteractions();
  return {
    completion: { kind: "none" },
    open: false,
    selected: 0,
    hints: [],
    interactions: store.snapshot(),
    store,
    awaiting: {
      ...awaitingQueue(item === undefined ? [] : [item], new Set()),
      forced: false,
    },
    move: () => false,
    highlight: () => undefined,
    complete: () => false,
    dismiss: () => false,
    submit: () => undefined,
    choose: () => undefined,
    available: (alias) => registered.has(alias),
    runCommand: () => undefined,
  };
}

type Scene = Readonly<{
  status?: ChatComposerProps["status"];
  draft?: string;
  images?: boolean;
  decision?: string;
}>;

/** The chat page around the composer: the timeline above, the composer docked below. */
function page(scene: Scene): Story {
  return () => {
    const [status, setStatus] = useState(scene.status ?? "idle");
    const [draft, setDraft] = useState(scene.draft ?? "");
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [images, setImages] = useState(() =>
      scene.images === true ? swatches() : undefined,
    );
    const slash = useMemo(
      () =>
        slashFor(
          scene.decision === undefined
            ? undefined
            : waitingDecision(scene.decision),
        ),
      [],
    );
    const busy = status !== "idle" && status !== "error";
    return (
      <div
        className="fixed inset-0 flex flex-col bg-base-100"
        data-composer-page=""
      >
        <div className="parakeet prose min-h-0 w-full max-w-none flex-1 overflow-y-auto px-md py-md">
          {turns.map((item) => (
            <div data-parakeet-entry={item.kind} key={item.id}>
              <TimelineItem item={item} />
            </div>
          ))}
        </div>
        <ChatComposer
          queuedRecall={{
            images,
            recallState: { kind: "idle" },
            recall: () => Promise.resolve("empty"),
          }}
          onImagesChange={setImages}
          draft={draft}
          model={{ provider: "openai", model: "gpt-6-luna" }}
          status={status}
          viewState={busy ? { kind: "responding" } : { kind: "idle" }}
          textareaRef={textareaRef}
          onChange={setDraft}
          onSend={() => {
            setStatus("streaming");
            setDraft("");
          }}
          onAbort={() => {
            setStatus("idle");
          }}
          usage={{ tokens: 18_452, cost: 0.0347 }}
          context={{ tokens: 12_345, window: 200_000 }}
          slash={slash}
        />
      </div>
    );
  };
}

export const Empty = page({});
export const TypingMultiLine = page({
  draft:
    "Use SQLite for now.\n\n- Keep notes on this computer.\n- One table per garden bed.\n- Show me the schema before you write the migration.",
});
export const Running = page({ status: "streaming" });
export const RunningWithDraft = page({
  status: "streaming",
  draft: "When this finishes, add keyboard controls.",
});
export const Attachments = page({
  images: true,
  draft: "These are the two bed layouts I sketched.",
});
export const QuestionTakeover = page({ decision: "single" });
export const ApprovalTakeover = page({
  decision: "approval",
});
export const ApprovalAppWrite = page({ decision: "approval app write" });
