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
 * The virtualizer's row-key callback. Progress replaces row payloads, including
 * live overlays on settled calls, but not row keys. Keep the callback and its
 * measurements until the order or identity of the combined rows changes.
 */
export function useTimelineItemKey(
  settled: readonly TimelineItem[],
  tail: readonly TimelineItem[],
): (index: number) => string | number {
  const next = [...settled, ...tail].map(rowKey);
  const [previous, setPrevious] = useState(next);
  const keys = sameKeys(previous, next) ? previous : next;
  if (keys !== previous) setPrevious(keys);
  return useCallback((index: number) => keys[index] ?? index, [keys]);
}
