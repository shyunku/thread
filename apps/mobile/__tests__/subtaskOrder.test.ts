import { buildModel } from '@/core/model/view';

// Synthetic rows only. The shared model writes sort_rank on a subtask move (#106, PC drag);
// rows from older clients have none and keep the created_at order after the ranked ones.
test('subtasks follow sort_rank, then created_at, then id, per task', () => {
  const model = buildModel({
    tasks: [
      { tid: 't1', title: 'T1', sort_rank: '1' },
      { tid: 't2', title: 'T2', sort_rank: '2' },
    ],
    subtasks: [
      { sid: 'late', tid: 't1', title: 'Late', created_at: 300 },
      { sid: 'second', tid: 't1', title: 'Second', created_at: 100, sort_rank: '8589934592' },
      { sid: 'other', tid: 't2', title: 'Other', created_at: 1 },
      { sid: 'early-b', tid: 't1', title: 'Early B', created_at: 50 },
      { sid: 'first', tid: 't1', title: 'First', created_at: 200, sort_rank: '4294967296' },
      { sid: 'early-a', tid: 't1', title: 'Early A', created_at: 50 },
    ],
    relations: [],
    categories: [],
  });
  const t1 = model.tasks.find(t => t.tid === 't1')!;
  expect(t1.subtasks.map(s => s.sid)).toEqual([
    'first',
    'second',
    'early-a',
    'early-b',
    'late',
  ]);
  expect(model.tasks.find(t => t.tid === 't2')!.subtasks.map(s => s.sid)).toEqual(['other']);
});
