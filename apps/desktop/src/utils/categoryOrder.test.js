import Category from "../objects/Category";
import { categoryMoveAnchor, compareCategories, sortCategories } from "./categoryOrder";

const make = (cid, created_at, sort_rank) =>
  Category.fromEntity({ cid, title: cid, created_at, ...(sort_rank == null ? {} : { sort_rank }) });

test("categories sort by sort_rank, unranked after ranked by created_at, then id", () => {
  const list = [
    make("late", 300),
    make("b", 100, "8589934592"),
    make("early", 50),
    make("a", 200, "4294967296"),
    make("tie2", 50),
  ];
  expect(sortCategories(list).map((c) => c.id)).toEqual(["a", "b", "early", "tie2", "late"]);
  expect(list[0].id).toBe("late"); // input untouched
  expect(make("x", 1).sortRank).toBeNull();
  expect(make("y", 1, "5").sortRank).toBe("5");
  // Bigints beyond Number precision still compare exactly.
  expect(compareCategories(make("p", 0, "9007199254740993"), make("q", 0, "9007199254740992"))).toBe(1);
  // A malformed rank is treated as missing.
  expect(sortCategories([make("bad", 1, "x1"), make("ok", 2, "1")]).map((c) => c.id)).toEqual(["ok", "bad"]);
});

test("categoryMoveAnchor gives the anchor for a drop position", () => {
  const ids = ["a", "b", "c", "d"];
  expect(categoryMoveAnchor(ids, "a", 0)).toBeNull();
  expect(categoryMoveAnchor(ids, "a", 2)).toEqual({ anchorId: "d", after: false });
  expect(categoryMoveAnchor(ids, "a", 3)).toEqual({ anchorId: "d", after: true });
  expect(categoryMoveAnchor(ids, "d", 0)).toEqual({ anchorId: "a", after: false });
  expect(categoryMoveAnchor(ids, "c", 1)).toEqual({ anchorId: "b", after: false });
  expect(categoryMoveAnchor(ids, "c", 99)).toEqual({ anchorId: "d", after: true });
  expect(categoryMoveAnchor(ids, "zz", 1)).toBeNull();
  expect(categoryMoveAnchor(["a"], "a", 0)).toBeNull();
});
