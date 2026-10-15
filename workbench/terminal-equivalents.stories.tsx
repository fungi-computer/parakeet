import type { Story, StoryDefault } from "@ladle/react";
import { useRef, useState } from "react";
import {
  ChatComposer,
  type ChatComposerProps,
} from "../src/components/ChatComposer.js";
import { WaitingNotice } from "../src/components/WaitingNotice.js";
import { ClientRows } from "../src/components/ClientRows.js";
import type { ClientContributionV1 } from "@fungi.computer/shiitake/client-entry";
import type { FixtureGoal } from "../test/fixtures/session.fixture.js";
import { z } from "zod";
import "@fungi.computer/parakeet/styles.css";

export default {
  title: "Parakeet / Terminal Equivalents",
} satisfies StoryDefault;
function composer(
  initial: ChatComposerProps["status"],
  extra: Partial<
    Pick<
      ChatComposerProps,
      "failure" | "failureCause" | "admissionError" | "draft" | "usage"
    >
  > = {},
): Story {
  return () => {
    const [status, setStatus] = useState(initial);
    const [draft, setDraft] = useState(extra.draft ?? "");
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    return (
      <main className="mx-auto flex min-h-96 w-full max-w-[48rem] flex-col justify-end p-md">
        <ChatComposer
          {...extra}
          draft={draft}
          failure={status === "error" ? extra.failure : undefined}
          model={{ provider: "fungi", model: "@fungi/luna" }}
          status={status}
          viewState={{ kind: "idle" }}
          textareaRef={textareaRef}
          onChange={setDraft}
          onSend={() => {
            setStatus("sending");
            setDraft("");
          }}
          onAbort={() => {
            setStatus("idle");
          }}
          onRetry={() => {
            setStatus("retrying");
          }}
          usage={extra.usage ?? { tokens: 18452, cost: 0.0347 }}
        />
      </main>
    );
  };
}
export const EmptyComposer = composer("idle", {
  usage: { tokens: 0, cost: 0 },
});
export const Draft = composer("idle", {
  draft: "Make the rain slower and keep the frog's jump height the same.",
});
export const LongDraft = composer("idle", {
  draft:
    "Update the garden plan:\n\n- Keep the shade-loving ferns by the wall.\n- Move the seed library closer to the entrance.\n- Leave a clear path for wheelchairs and prams.\n\nShow me the changes before publishing.",
});
export const Sending = composer("sending");
export const Thinking = composer("thinking");
export const Streaming = composer("streaming");
export const Queued = composer("queued", {
  draft: "When this finishes, add keyboard controls.",
});
export const Cancelling = composer("cancelling");
export const Retrying = composer("retrying");
export const Disconnected = composer("disconnected");
export const Failed = composer("error", {
  failure: "failed",
  failureCause:
    "The model provider is temporarily unavailable. Your prompt is preserved.",
});
export const Interrupted = composer("error", { failure: "interrupted" });
export const AdmissionRefused = composer("error", {
  failure: "admission",
  failureCause: "Your Team is out of credit. Add credit in Billing.",
});
export const QueueFull = composer("thinking", {
  admissionError: "queue_full",
  draft: "Please check the final result at phone width.",
});
export const Waiting: Story = () => (
  <div className="mx-auto max-w-[48rem] p-md">
    <WaitingNotice
      waiting={{
        kind: "queued",
        queuedCommandId: "garden-follow-up",
        runningWork: null,
      }}
    />
  </div>
);
function goal(initial: FixtureGoal["state"], offline = false): Story {
  return () => {
    const [state, setState] = useState(initial);
    const rows: ClientContributionV1["panel"] = [
      {
        id: "goal",
        title:
          "Build and preview the field-notes App, then wait for my approval before publishing.",
        detail: `Goal · ${state}`,
        actions:
          state === "active" || state === "paused"
            ? [
                {
                  id: "change",
                  label: state === "active" ? "Pause goal" : "Resume goal",
                  input: { action: state === "active" ? "pause" : "resume" },
                },
              ]
            : [],
      },
      ...(state === "blocked"
        ? [
            {
              id: "reason",
              title: "The Computer needs access to the repository.",
            },
          ]
        : []),
    ];
    return (
      <div className="mx-auto max-w-[48rem] p-md">
        <ClientRows
          entryId="example"
          rows={rows}
          actions={{
            state: new Map(),
            enabled: !offline,
            execute: (_entryId, action) => {
              const input = z
                .object({ action: z.enum(["pause", "resume"]) })
                .parse(action.input);
              setState(input.action === "pause" ? "paused" : "active");
              return Promise.resolve();
            },
          }}
        />
      </div>
    );
  };
}
export const ActiveGoal = goal("active");
export const PausedGoal = goal("paused");
export const CompletedGoal = goal("complete");
export const BlockedGoal = goal("blocked");
export const DisconnectedGoal = goal("active", true);
