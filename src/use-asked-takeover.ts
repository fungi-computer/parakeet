import { useRef, useSyncExternalStore } from "react";

import type { AwaitingItem } from "./core/awaiting-answer.js";

const noSubscription = () => () => undefined;
const noSnapshot = () => undefined;

/**
 * The waiting item the composer may be taken over for: one that has asked its
 * question. A queued item whose conversation has not asked anything has
 * nothing to draw, and taking the composer over for it leaves a blank bar and
 * no way to type. Once an item has asked, it keeps the composer through its
 * answer, whose card shows the sending state.
 */
export function useAskedTakeover(
  candidate: AwaitingItem | undefined,
): AwaitingItem | undefined {
  const snapshot = useSyncExternalStore(
    candidate?.host.subscribe ?? noSubscription,
    candidate === undefined ? noSnapshot : candidate.host.snapshot,
  );
  const asked = useRef(new Set<string>());
  if (candidate === undefined) {
    asked.current.clear();
    return undefined;
  }
  // Only the item in front is remembered; one that left the queue is forgotten.
  for (const key of asked.current)
    if (key !== candidate.key) asked.current.delete(key);
  if (snapshot?.prompt !== undefined) asked.current.add(candidate.key);
  return asked.current.has(candidate.key) ? candidate : undefined;
}
