import type {
  ClientContributionV1,
  ClientTimelineCellV1,
} from "@fungi.computer/shiitake/client-entry";
import { expect, it } from "vitest";
import { placeClientTimeline } from "../src/core/client-timeline.js";

const cell = (
  sequence: number,
  afterSequence: number | null,
  at = sequence,
): ClientTimelineCellV1 => {
  const value: ClientTimelineCellV1 = {
    id: String(sequence),
    sequence,
    commandId: null,
    at,
    rows: [{ id: "state", title: `Change ${String(sequence)}` }],
  };
  if (afterSequence === null) return value;
  return { ...value, afterSequence };
};
const contribution = (
  cells: readonly ClientTimelineCellV1[],
  omitted = 0,
): ClientContributionV1 => ({
  chips: [],
  panel: [],
  waiting: null,
  timeline: { cells, omitted },
});

it("distinguishes an empty Session position from an unanchored change", () => {
  const entries = [
    { entryId: "goal", value: contribution([cell(1, 0), cell(2, null)]) },
  ];
  const placed = placeClientTimeline(entries, new Map(), new Map([[0, null]]));
  expect(placed.before.map(({ cell }) => cell.id)).toEqual(["1"]);
  expect(placed.unanchored.map(({ cell }) => cell.id)).toEqual(["2"]);
  expect(placed.after.size).toBe(0);
});

it("places committed cells at fixed loaded Session positions and labels unanchored changes separately", () => {
  const entries = [
    {
      entryId: "probe",
      value: contribution(
        [cell(1, 10), cell(2, 20), cell(3, null), cell(4, 5)],
        9,
      ),
    },
  ];
  const anchors = new Map([
    [10, "assistant-final"],
    [20, "tool-group-final"],
  ]);
  const placed = placeClientTimeline(entries, new Map(), anchors);
  expect(
    [...placed.after].map(([id, cells]) => [
      id,
      cells.map(({ cell }) => cell.id),
    ]),
  ).toEqual([
    ["assistant-final", ["1"]],
    ["tool-group-final", ["2"]],
  ]);
  expect(placed.unanchored.map(({ cell }) => cell.id)).toEqual(["3"]);
  expect(placed.omitted).toEqual([{ entryId: "probe", count: 9 }]);
  anchors.set(5, "older-message");
  expect(
    placeClientTimeline(entries, new Map(), anchors)
      .after.get("older-message")
      ?.map(({ cell }) => cell.id),
  ).toEqual(["4"]);
});

it("merges producer heads deterministically without reversing a producer after clock rollback", () => {
  const entries = [
    {
      entryId: "a",
      value: contribution([cell(2, null, 1), cell(1, null, 50)]),
    },
    {
      entryId: "b",
      value: contribution([cell(1, null, 20), cell(2, null, 40)]),
    },
  ];
  expect(
    placeClientTimeline(entries, new Map()).unanchored.map(
      ({ entryId, cell }) => `${entryId}:${String(cell.sequence)}`,
    ),
  ).toEqual(["b:1", "b:2", "a:1", "a:2"]);
  const tied = [
    { entryId: "b", value: contribution([cell(1, 12, 1)]) },
    { entryId: "a", value: contribution([cell(1, 12, 1)]) },
  ];
  expect(
    placeClientTimeline(tied, new Map(), new Map([[12, "last"]]))
      .after.get("last")
      ?.map(({ entryId }) => entryId),
  ).toEqual(["a", "b"]);
});

it("retains V1 command placement for entries that choose a command anchor", () => {
  const entries = [
    {
      entryId: "command-entry",
      value: contribution([{ ...cell(1, null), commandId: "work" }]),
    },
  ];
  expect(
    placeClientTimeline(entries, new Map([["work", "last-loaded-output"]]))
      .after.get("last-loaded-output")
      ?.map(({ cell }) => cell.id),
  ).toEqual(["1"]);
});
