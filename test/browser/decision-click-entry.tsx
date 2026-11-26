import { useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";

import { DecisionComposer } from "../../src/components/DecisionComposer.js";
import { awaitingQueue } from "../../src/core/awaiting-answer.js";
import type {
  ApprovalAnswerInput,
  ApprovalFacts,
  ApprovalSource,
} from "../../src/core/approval-decision.js";
import { createParakeetInteractions } from "../../src/commands/interactions.js";
import { useApprovalAwaiting } from "../../src/use-approval-awaiting.js";

const root = document.querySelector<HTMLElement>("#root");
if (root === null) throw new Error("decision fixture root is missing");

// The card as setup's Tourtois approval draws it: Approve once, the family
// rule, Deny, and the written Deny line. It is asked by the production hook
// over one session store, so a hidden owner and a lost right are the real ones.
const answers: ApprovalAnswerInput[] = [];
Reflect.set(globalThis, "decisionAnswers", answers);
const store = createParakeetInteractions();

const facts = (canAnswer: boolean): ApprovalFacts => ({
  record: {
    recordId: "record:fixture",
    revision: 1,
    requester: {
      displayName: "Shiitake",
      agentId: "agent:fixture",
      sessionId: "session:fixture",
      principalId: "agent:fixture",
    },
    module: "app:tourtois",
    operation: "layout.place",
    access: "write",
    description: {
      app: {
        displayName: "Tourtois",
        operationLabel: "Add a widget to your dashboard",
      },
      inputBytes: 12,
      inputSha256: "0".repeat(64),
    },
    reversibility: "reversible",
    expiresAt: Date.now() + 3_600_000,
  },
  canAnswer,
});

let view = facts(true);
const listeners = new Set<() => void>();
const source: ApprovalSource = {
  snapshot: () => view,
  subscribe: (listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  answer: (input) => {
    answers.push(input);
    return Promise.resolve({ kind: "answered" });
  },
  family: {
    label: "Always allow Tourtois to make changes",
    enable: () => Promise.resolve(true),
  },
};

let owned = true;

/** The hook as Grove's ApprovalOwner runs it: no source while the right is gone. */
function Owner() {
  useSyncExternalStore(source.subscribe, source.snapshot);
  useApprovalAwaiting({
    source: view.canAnswer ? source : undefined,
    store,
    enabled: true,
    home: "",
    width: 72,
    noteLimit: 512,
    onFailure: () => undefined,
  });
  return null;
}

function Card() {
  const state = useSyncExternalStore(store.subscribe, store.snapshot);
  const queue = awaitingQueue(state.awaiting.items, state.awaiting.later);
  return queue.current === undefined ? null : (
    <DecisionComposer
      key={queue.current.key}
      item={queue.current}
      position={queue.position}
      total={queue.total}
      onLater={() => undefined}
      takeFocus={false}
    />
  );
}

const reactRoot = createRoot(root);
const draw = () => {
  reactRoot.render(
    <main className="flex h-screen flex-col justify-end bg-base-200 p-lg">
      {owned ? <Owner /> : null}
      <Card />
    </main>,
  );
};
draw();

// A poll or refresh of the same record re-renders everything with fresh props.
Reflect.set(globalThis, "refreshCard", () => {
  flushSync(draw);
});
// The owner unmounts (the connection became undefined) or is drawn again.
Reflect.set(globalThis, "setOwned", (next: boolean) => {
  owned = next;
  flushSync(draw);
});
// The member's right to answer is lost or restored on the same record.
Reflect.set(globalThis, "setAnswerable", (next: boolean) => {
  view = facts(next);
  for (const listener of listeners) listener();
  flushSync(draw);
});
