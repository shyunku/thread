// Subtask drag (#112): where a lifted row lands and the task/updateSubtaskOrder arguments
// for it, the same anchor rule as the PC (desktop utils/categoryOrder.js categoryMoveAnchor):
// before the row that follows it, or after the last one.

// The index the lifted row takes among the others: one past every row whose middle is
// above the lifted row's middle. `others` are the other rows' middles, top to bottom.
export function dropIndex(others: number[], center: number) {
  return others.filter(middle => middle < center).length;
}

// (anchor id, after) for the dropped order, read against the rows there are now: rows
// deleted meanwhile are left out, new ones stay at the end. Null when the lifted row is
// gone or nothing moves.
export function dropAnchor(
  current: string[],
  dropped: string[],
  id: string,
): { anchorId: string; after: boolean } | null {
  if (!current.includes(id)) return null;
  const order = [
    ...dropped.filter(other => current.includes(other)),
    ...current.filter(other => !dropped.includes(other)),
  ];
  if (order.join() === current.join()) return null;
  const index = order.indexOf(id);
  return index < order.length - 1
    ? { anchorId: order[index + 1], after: false }
    : { anchorId: order[index - 1], after: true };
}
