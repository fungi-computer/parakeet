import type { ClientTimelineCellV1 } from "@fungi.computer/shiitake/client-entry";
import type { ClientContribution } from "./client-contributions.js";

/** A committed cell retains its producer namespace in every renderer. */
export type PlacedClientCell = Readonly<{
  /** Namespace of the entry that produced this committed event. */
  entryId: string;
  /** Producer event, unchanged by host placement. */
  cell: ClientTimelineCellV1;
}>;

/** Merge producer heads: clock rollback never reverses a producer's sequence. */
function mergeCells(cells: readonly PlacedClientCell[]): PlacedClientCell[] {
  const streams = new Map<string, PlacedClientCell[]>();
  for (const cell of cells) {
    const stream = streams.get(cell.entryId);
    if (stream === undefined) streams.set(cell.entryId, [cell]);
    else stream.push(cell);
  }
  for (const stream of streams.values())
    stream.sort((left, right) => left.cell.sequence - right.cell.sequence);
  const merged: PlacedClientCell[] = [];
  while (streams.size > 0) {
    const heads = [...streams.values()].flatMap((stream) =>
      stream[0] === undefined ? [] : [stream[0]],
    );
    heads.sort(
      (left, right) =>
        left.cell.at - right.cell.at ||
        (left.entryId < right.entryId
          ? -1
          : left.entryId > right.entryId
            ? 1
            : 0) ||
        left.cell.sequence - right.cell.sequence,
    );
    const next = heads[0];
    if (next === undefined) break;
    merged.push(next);
    const stream = streams.get(next.entryId);
    stream?.shift();
    if (stream?.length === 0) streams.delete(next.entryId);
  }
  return merged;
}

/** Fixed positions and command anchors follow loaded history, never event time. */
export function placeClientTimeline(
  entries: readonly ClientContribution[],
  anchors: ReadonlyMap<string, string>,
  positions: ReadonlyMap<number, string | null> = new Map(),
) {
  const anchored = new Map<string, PlacedClientCell[]>();
  const before: PlacedClientCell[] = [];
  const unanchored: PlacedClientCell[] = [];
  for (const { entryId, value } of entries) {
    for (const cell of value.timeline.cells) {
      const placed = { entryId, cell };
      if (cell.afterSequence === undefined && cell.commandId === null) {
        unanchored.push(placed);
        continue;
      }
      const itemId =
        cell.afterSequence !== undefined
          ? positions.get(cell.afterSequence)
          : cell.commandId === null
            ? undefined
            : anchors.get(cell.commandId);
      if (itemId === undefined) continue;
      if (itemId === null) {
        before.push(placed);
        continue;
      }
      const existing = anchored.get(itemId);
      if (existing === undefined) anchored.set(itemId, [placed]);
      else existing.push(placed);
    }
  }
  return {
    /** Events before the first visible row of the root history page. */
    before: mergeCells(before),
    /** Loaded durable row IDs mapped to their following committed events. */
    after: new Map([...anchored].map(([id, cells]) => [id, mergeCells(cells)])),
    /** Null-anchor events for the separate Extension changes section. */
    unanchored: mergeCells(unanchored),
    /** Factual producer retention counts, independent of loaded message pages. */
    omitted: entries.flatMap(({ entryId, value }) =>
      value.timeline.omitted === 0
        ? []
        : [
            {
              /** Producer namespace for the retention notice. */
              entryId,
              /** Number of committed events omitted by this producer. */
              count: value.timeline.omitted,
            },
          ],
    ),
  };
}
