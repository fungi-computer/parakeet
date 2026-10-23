import { useCallback, useState } from "react";

import type { TimelineItem } from "../store/types.js";

/** One submitted prompt keeps one row from submit to durable: no remount. */
function rowKey(item: TimelineItem): string {
  return item.kind === "user_message" && item.requestId !== undefined
    ? item.requestId
    : item.id;
}

function sameKeys(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((key, index) => key === b[index]);
}

/**
 * The virtualizer's row-key callback. Text-only progress replaces tail items
 * but not their keys, so the callback keeps its identity, and the virtualizer
 * its measurements, until the settled history or the order or identity of the
 * tail rows changes. Settled rows are keyed from the settled list alone.
 */
export function useTimelineItemKey(
  settled: readonly TimelineItem[],
  tail: readonly TimelineItem[],
): (index: number) => string | number {
  const next = tail.map(rowKey);
  const [previous, setPrevious] = useState(next);
  const tailKeys = sameKeys(previous, next) ? previous : next;
  if (tailKeys !== previous) setPrevious(tailKeys);
  return useCallback(
    (index: number) => {
      const item = settled[index];
      if (item !== undefined) return rowKey(item);
      return tailKeys[index - settled.length] ?? index;
    },
    [settled, tailKeys],
  );
}
