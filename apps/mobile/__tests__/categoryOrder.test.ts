import { buildModel } from '@/core/model/view';

// Synthetic rows only. The shared model writes sort_rank on a move (#102); rows from
// older clients have none and keep the created_at order after the ranked ones.
test('categories follow sort_rank, then created_at, then id', () => {
  const model = buildModel({
    tasks: [],
    subtasks: [],
    relations: [],
    categories: [
      { cid: 'late', title: 'Late', created_at: 300 },
      { cid: 'second', title: 'Second', created_at: 100, sort_rank: '8589934592' },
      { cid: 'early', title: 'Early', created_at: 50 },
      { cid: 'first', title: 'First', created_at: 200, sort_rank: '4294967296' },
      { cid: 'bad', title: 'Bad', created_at: 50, sort_rank: 'x' },
    ],
  });
  expect(model.categories.map(c => c.cid)).toEqual([
    'first',
    'second',
    'bad',
    'early',
    'late',
  ]);
  expect(model.categories[0].sortRank).toBe(BigInt('4294967296'));
  expect(model.categories[2].sortRank).toBeNull();
});
