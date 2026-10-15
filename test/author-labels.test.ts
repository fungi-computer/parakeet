import { expect, it } from "vitest";
import { authorDisplayNames } from "../src/core/author-labels.js";

it("keeps a single author and repeated lines from that author plain", () => {
  expect([
    ...authorDisplayNames([
      { id: "user_ada_one", name: "Ada" },
      { id: "user_ada_one", name: "Ada" },
      { id: "user_sam", name: "Sam" },
    ]),
  ]).toEqual([
    ["user_ada_one", "Ada"],
    ["user_sam", "Sam"],
  ]);
});

it("disambiguates distinct same-named authors, not other authors", () => {
  expect([
    ...authorDisplayNames([
      { id: "user_ada_one", name: "Ada" },
      { id: "user_ada_two", name: "Ada" },
      { id: "user_sam", name: "Sam" },
    ]),
  ]).toEqual([
    ["user_ada_one", "Ada · da_one"],
    ["user_ada_two", "Ada · da_two"],
    ["user_sam", "Sam"],
  ]);
});

it("relabels existing authors when a same-named author joins the timeline", () => {
  const first = { id: "user_ada_one", name: "Ada" };
  expect(authorDisplayNames([first]).get(first.id)).toBe("Ada");
  expect(
    authorDisplayNames([first, { id: "user_ada_two", name: "Ada" }]).get(
      first.id,
    ),
  ).toBe("Ada · da_one");
});
