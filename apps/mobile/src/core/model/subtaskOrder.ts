// Subtask drag (#112): where a lifted row lands and the task/updateSubtaskOrder arguments
// for it, the same anchor rule as the PC (desktop utils/categoryOrder.js categoryMoveAnchor).

// The index the lifted row takes among the others: one past every row whose middle is
// above the lifted row's middle. `others` are the other rows' middles, top to bottom.
export function dropIndex(others: number[], center: number) {
  return others.filter(middle => middle < center).length;
}

// (anchor id, after) that put `id` at `toIndex` of the final order; null when nothing moves.
export function subtaskMoveAnchor(
  orderedIds: string[],
  id: string,
  toIndex: number,
): { anchorId: string; after: boolean } | null {
  const from = orderedIds.indexOf(id);
  if (from < 0) return null;
  const rest = orderedIds.filter(other => other !== id);
  if (!rest.length) return null;
  const index = Math.max(0, Math.min(rest.length, toIndex));
  if (index === from) return null;
  return index < rest.length
    ? { anchorId: rest[index], after: false }
    : { anchorId: rest[rest.length - 1], after: true };
}
