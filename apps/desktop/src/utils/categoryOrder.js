/* global BigInt */
// Sidebar category order (#102). Same rule as the shared model's compareRank
// (packages/e2ee/src/model/optimistic.js), so a move lands where the user dropped it:
// sort_rank first (categories without one come after, as before #102), then created_at,
// then id.
const rankOf = (category) =>
  typeof category?.sortRank === "string" && /^(0|[1-9][0-9]*)$/.test(category.sortRank)
    ? BigInt(category.sortRank)
    : null;
const timeOf = (value) =>
  value instanceof Date ? value.getTime() : typeof value === "number" ? value : 0;

export function compareCategories(a, b) {
  const x = rankOf(a),
    y = rankOf(b);
  if (x !== y) return x === null ? 1 : y === null ? -1 : x < y ? -1 : 1;
  const t = timeOf(a.createdAt) - timeOf(b.createdAt);
  if (t) return t < 0 ? -1 : 1;
  return a.id < b.id ? -1 : a.id === b.id ? 0 : 1;
}

export function sortCategories(categories) {
  return [...categories].sort(compareCategories);
}

// Arguments for category/updateCategoryOrder that put `id` at `toIndex` of the final
// list. Returns null when nothing moves.
export function categoryMoveAnchor(orderedIds, id, toIndex) {
  const from = orderedIds.indexOf(id);
  if (from < 0) return null;
  const rest = orderedIds.filter((other) => other !== id);
  if (!rest.length) return null;
  const index = Math.max(0, Math.min(rest.length, toIndex));
  if (index === from) return null;
  return index < rest.length
    ? { anchorId: rest[index], after: false }
    : { anchorId: rest[rest.length - 1], after: true };
}
