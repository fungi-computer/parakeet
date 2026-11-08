import type { StoryDefault } from "@ladle/react";
import { EmptyState } from "@fungi.computer/caps/blocks/empty-state";
import { RunFailureNotice } from "../src/components/RunFailureNotice.js";
import { TimelineItem } from "../src/components/TimelineItem.js";
import {
  ParakeetHostFactsContext,
  type ParakeetHostFacts,
} from "../src/host-facts.js";
import type { TimelineItem as Row } from "../src/store/types.js";
import "@fungi.computer/parakeet/styles.css";

export default { title: "Parakeet / First run" } satisfies StoryDefault;

const modelFailure: Row = {
  id: "error-0",
  kind: "assistant_message",
  isError: true,
  pending: false,
  at: 1,
  text: "Model request failed (provider_unavailable). Retry the request.",
  usage: { cost: 0, tokens: 0 },
  providerError: "request_id: req_1",
  repeatCount: 4,
};

const noModel: ParakeetHostFacts = {
  modelSetup: {
    state: "missing",
    fix: { label: "Add a model key", onSelect: () => undefined },
  },
};

function Frame({
  facts,
  children,
}: Readonly<{ facts: ParakeetHostFacts; children: React.ReactNode }>) {
  return (
    <ParakeetHostFactsContext.Provider value={facts}>
      <div className="parakeet mx-auto flex max-w-[42rem] flex-col gap-3 p-md">
        {children}
      </div>
    </ParakeetHostFactsContext.Provider>
  );
}

/** Four identical failures, no model connected: one line with the fix. */
export const NoModelConnected = () => (
  <Frame facts={noModel}>
    <TimelineItem item={modelFailure} />
  </Frame>
);

/** Four identical failures where setup is not known: one line with a count. */
export const FoldedFailure = () => (
  <Frame facts={{}}>
    <TimelineItem item={modelFailure} />
    <RunFailureNotice failure="failed" onRetry={() => undefined} />
  </Frame>
);

/** A host with no billing never mentions credits. */
export const NoBilling = () => (
  <Frame facts={{ billing: false }}>
    <RunFailureNotice failure="failed" onRetry={() => undefined} />
  </Frame>
);

/** The empty conversation offers the host's starters. */
export const Starters = () => (
  <Frame facts={{}}>
    <EmptyState
      description="Pick one to start, or type your own below."
      suggestions={[
        "Plan a weekend trip",
        "Summarize my notes",
        "Draft an email",
      ].map((label) => ({ label, onSelect: () => undefined }))}
      title="What would you like to do?"
      variant="quiet"
    />
  </Frame>
);
