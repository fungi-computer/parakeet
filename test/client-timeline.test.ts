import type {
  ClientContributionV1,
  ClientTimelineCellV1,
} from "@fungi.computer/shiitake/client-entry";
import { expect, it } from "vitest";
import { placeClientTimeline } from "../src/core/client-timeline.js";

const cell = (
  sequence: number,
  commandId: string | null,
  at = sequence,
): ClientTimelineCellV1 => ({
  id: String(sequence),
  sequence,
  commandId,
  at,
  rows: [{ id: "state", title: `Change ${String(sequence)}` }],
});
const contribution = (
  cells: readonly ClientTimelineCellV1[],
  omitted = 0,
): ClientContributionV1 => ({
  chips: [],
  panel: [],
  waiting: null,
  timeline: { cells, omitted },
});

it("places committed cells after their real loaded command and labels unanchored changes separately", () => {
  const entries = [
    {
      entryId: "probe",
      value: contribution(
        [
          cell(1, "command-one"),
          cell(2, "command-two"),
          cell(3, null),
          cell(4, "older-command"),
        ],
        9,
      ),
    },
  ];
  const anchors = new Map([
    ["command-one", "assistant-final"],
    ["command-two", "tool-group-final"],
  ]);
  const placed = placeClientTimeline(entries, anchors);
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
  anchors.set("older-command", "older-message");
  expect(
    placeClientTimeline(entries, anchors)
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
    { entryId: "b", value: contribution([cell(1, "same", 1)]) },
    { entryId: "a", value: contribution([cell(1, "same", 1)]) },
  ];
  expect(
    placeClientTimeline(tied, new Map([["same", "last"]]))
      .after.get("last")
      ?.map(({ entryId }) => entryId),
  ).toEqual(["a", "b"]);
});
