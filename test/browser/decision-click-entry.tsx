import { createRoot } from "react-dom/client";
import { createWhistleInteractionHost } from "@fungi.computer/whistle/interaction";

import { DecisionComposer } from "../../src/components/DecisionComposer.js";
import type { AwaitingItem } from "../../src/core/awaiting-answer.js";

const root = document.querySelector<HTMLElement>("#root");
if (root === null) throw new Error("decision fixture root is missing");

// The card as setup's Tourtois approval draws it: Approve once, the family
// rule, Deny, and the written Deny line.
const host = createWhistleInteractionHost({ title: "Approval" });
const session = host.begin();
const item: AwaitingItem = {
  key: "approval:fixture",
  kind: "approval",
  arrivedAt: 0,
  host,
};
const answers: unknown[] = [];
Reflect.set(globalThis, "decisionAnswers", answers);
void session.interaction
  .prompt({
    type: "decision",
    message: "Allow Tourtois to add a widget to your dashboard?",
    summary: "Shiitake wants to make a change in Tourtois.",
    options: [
      { value: "approve", label: "Approve once" },
      { value: "family", label: "Always allow Tourtois to change data" },
      { value: "deny", label: "Deny" },
    ],
    other: {
      label: "Deny and say why…",
      maxLength: 512,
      blank: "deny",
    },
  })
  .then((answer) => {
    answers.push(answer);
  });

const reactRoot = createRoot(root);
const draw = (renders: number) => {
  reactRoot.render(
    <main
      className="flex h-screen flex-col justify-end bg-base-200 p-lg"
      data-renders={renders}
    >
      <DecisionComposer
        item={{ ...item }}
        position={1}
        total={1}
        onLater={() => undefined}
        takeFocus={false}
      />
    </main>,
  );
};
let renders = 0;
draw(renders);
// A refresh of the same record re-renders the card with fresh props.
Reflect.set(globalThis, "refreshCard", () => {
  renders += 1;
  draw(renders);
});
