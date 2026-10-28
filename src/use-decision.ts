import { useRef, useState, useSyncExternalStore } from "react";
import type { WhistleDecisionAnswer } from "@fungi.computer/whistle";
import type { WhistleInteractionSnapshot } from "@fungi.computer/whistle/interaction";

import {
  decisionView,
  initialDecisionState,
  reduceDecision,
  type AwaitingItem,
  type DecisionIntent,
  type DecisionPrompt,
  type DecisionState,
  type DecisionView,
} from "./core/awaiting-answer.js";

/** One decision being answered, ready for a renderer to draw and drive. */
export type DecisionController = Readonly<{
  /** What to draw; absent only before the first prompt has arrived. */
  view: DecisionView | undefined;
  /** Apply what the person did; every key and click goes through here. */
  dispatch: (intent: DecisionIntent) => void;
  /** Postpone this decision: it leaves the composer and waits in the footer. */
  later: () => void;
}>;

type Held = Readonly<{ sequence: number; state: DecisionState }>;

/** The state as the person sees it: the reducer's, over what the host reports. */
function visibleState(
  held: DecisionState,
  snapshot: WhistleInteractionSnapshot,
): DecisionState {
  if (snapshot.prompt !== undefined) return held;
  return snapshot.status === "failed"
    ? {
        ...held,
        phase: "refused",
        refusal: snapshot.failure ?? "Something went wrong.",
      }
    : { ...held, phase: "sending" };
}

/**
 * Own the answering of one waiting decision for any renderer: the reducer's
 * state per prompt, the answer sent to the item's host, and the refusal that
 * comes back. Renderers draw `view` and forward intents, nothing else.
 */
export function useDecision(
  item: AwaitingItem,
  context: Readonly<{ position: number; total: number; later: () => void }>,
): DecisionController {
  const { host } = item;
  const snapshot = useSyncExternalStore(host.subscribe, host.snapshot);
  const shown = useRef<{ sequence: number; prompt: DecisionPrompt }>();
  const pending = snapshot.prompt;
  if (pending?.request.type === "decision")
    shown.current = { sequence: pending.sequence, prompt: pending.request };
  const [, setHeld] = useState<Held>();
  // Several keys can arrive before React renders; each must see the last one.
  const latest = useRef<Held>();
  const prompt = shown.current;
  const held = (): DecisionState =>
    prompt !== undefined && latest.current?.sequence === prompt.sequence
      ? latest.current.state
      : initialDecisionState();
  const remember = (next: DecisionState) => {
    if (prompt === undefined) return;
    latest.current = { sequence: prompt.sequence, state: next };
    setHeld(latest.current);
  };
  return {
    view:
      prompt === undefined
        ? undefined
        : decisionView(visibleState(held(), snapshot), prompt.prompt, {
            kind: item.kind,
            position: context.position,
            total: context.total,
          }),
    later: context.later,
    dispatch: (intent) => {
      if (prompt === undefined) return;
      const now = host.snapshot();
      if (now.prompt === undefined && now.status === "failed") {
        // The conversation failed after the person answered: try it again.
        if (intent.type === "enter") host.retry();
        else if (intent.type === "escape") context.later();
        return;
      }
      const outcome = reduceDecision(
        visibleState(held(), now),
        intent,
        prompt.prompt,
      );
      remember(outcome.state);
      const effect = outcome.effect;
      if (effect?.type === "later") context.later();
      else if (effect?.type === "answer") {
        const answer: WhistleDecisionAnswer = { selected: effect.selected };
        if (effect.text !== undefined) answer.text = effect.text;
        const accepted = host.answer(prompt.sequence, answer);
        if (!accepted)
          remember(
            reduceDecision(
              outcome.state,
              {
                type: "refused",
                message: "That answer was not accepted. Choose again.",
              },
              prompt.prompt,
            ).state,
          );
      }
    },
  };
}
