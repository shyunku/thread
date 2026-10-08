import { fireEvent, render, screen } from '@testing-library/react-native';
import {
  initialWindowMetrics,
  SafeAreaProvider,
} from 'react-native-safe-area-context';
import { buildModel, sortTasks, visibleTasks } from '@/core/model/view';
import { sanitize } from '@/core/prefs';
import { AddTaskSheet } from '@/screens/app/TasksScreen';
import { TaskItem } from '@/screens/app/parts';

// The first render loads the icon set.
jest.setTimeout(30000);

const mockApp = {
  mutate: jest.fn(),
  model: null as any,
  prefs: sanitize({}),
};
jest.mock('@/app/AppContext', () => ({ useApp: () => mockApp }));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn() }),
}));

// Starred a and d; b has no key; d sits in a secret category.
const model = buildModel({
  tasks: [
    { tid: 'a', title: 'A', important: true, created_at: 1, due_date: 30 },
    { tid: 'b', title: 'B', created_at: 2, due_date: 10 },
    { tid: 'c', title: 'C', important: false, created_at: 3, due_date: 20 },
    { tid: 'd', title: 'D', important: true, created_at: 4 },
  ],
  subtasks: [],
  categories: [{ cid: 's', title: 'S', secret: true, created_at: 1 }],
  relations: [{ tid: 'd', cid: 's' }],
});

beforeEach(() => mockApp.mutate.mockClear());

test('important comes from the task row; a missing key is not starred', () => {
  expect(model.tasks.map(t => [t.tid, t.important])).toEqual([
    ['a', true],
    ['b', false],
    ['c', false],
    ['d', true],
  ]);
});

test('the 중요 view shows starred tasks, still hiding secret categories', () => {
  const ids = (scope: any) => visibleTasks(model, scope).map(t => t.tid);
  expect(ids({ kind: 'important' })).toEqual(['a']);
  expect(ids({ kind: 'all' })).toEqual(['a', 'b', 'c']);
  expect(ids({ kind: 'category', cid: 's' })).toEqual(['d']);
});

test('the importance sort is gone; a stored one falls back to 기한 순', () => {
  expect(sanitize({ sort: 'importance' }).sort).toBe('due');
  expect(sanitize({ sort: 'remaining' }).sort).toBe('remaining');
  // An unknown mode sorts like 생성일 순, not by the old manual order.
  expect(sortTasks(model.tasks, 'importance' as any).map(t => t.tid)).toEqual([
    'd',
    'c',
    'b',
    'a',
  ]);
});

test('the row star toggles important without opening the task', async () => {
  const open = jest.fn();
  await render(
    <TaskItem task={model.tasks[1]} model={model} now={0} onPress={open} />,
  );
  await fireEvent.press(screen.getByLabelText('중요로 표시'));
  expect(mockApp.mutate).toHaveBeenCalledWith('task/updateTaskImportant', [
    'b',
    true,
  ]);
  expect(open).not.toHaveBeenCalled();

  await render(
    <TaskItem task={model.tasks[0]} model={model} now={0} onPress={open} />,
  );
  await fireEvent.press(screen.getByLabelText('중요 해제'));
  expect(mockApp.mutate).toHaveBeenLastCalledWith('task/updateTaskImportant', [
    'a',
    false,
  ]);
  expect(open).not.toHaveBeenCalled();
});

test('a task added in the 중요 view is starred', async () => {
  mockApp.model = model;
  await render(
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <AddTaskSheet visible onClose={() => {}} scope={{ kind: 'important' }} />
    </SafeAreaProvider>,
  );
  await fireEvent.changeText(
    screen.getByPlaceholderText('새 할 일 제목'),
    '새 일',
  );
  await fireEvent.press(screen.getByText('추가'));
  expect(mockApp.mutate).toHaveBeenCalledWith('task/addTask', [
    expect.objectContaining({ title: '새 일', important: true }),
  ]);
});
