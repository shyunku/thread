import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Keyboard } from 'react-native';
import { buildModel } from '@/core/model/view';
import { dropAnchor, dropIndex } from '@/core/model/subtaskOrder';
import TaskDetailScreen, { UNDO_MS } from '@/screens/app/TaskDetailScreen';
import { sanitize } from '@/core/prefs';

// Subtasks on the task screen (#112, report M2 · M3): tap a name to edit, an empty name
// goes back, delete with a 5-second undo, the add field adds on a tap elsewhere, hold a
// row and drag it to reorder. Synthetic rows only.
jest.setTimeout(30000);

const mockApp = {
  mutate: jest.fn((..._args: any[]): string | null => null),
  model: null as any,
  prefs: sanitize({}),
};
jest.mock('@/app/AppContext', () => ({ useApp: () => mockApp }));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
  useRoute: () => ({ params: { tid: 't1' } }),
}));

const modelWith = (subtasks: any[]) =>
  buildModel({
    tasks: [{ tid: 't1', title: '제주 여행 준비', created_at: 1 }],
    subtasks,
    categories: [],
    relations: [],
  });
const SUBS = [
  { sid: 'a', tid: 't1', title: '항공권 예매 확인', created_at: 10, done: true, done_at: 50 },
  { sid: 'b', tid: 't1', title: '숙소 체크인 시간 문의', created_at: 20 },
  { sid: 'c', tid: 't1', title: '짐 싸기', created_at: 30 },
];

// Keyboard events come from the test.
const keyboard: Record<string, () => void> = {};
beforeEach(() => {
  mockApp.mutate.mockClear();
  mockApp.model = modelWith(SUBS);
  jest
    .spyOn(Keyboard, 'addListener')
    .mockImplementation((event: any, listener: any) => {
      keyboard[event] = listener;
      return { remove() {} } as any;
    });
});
afterEach(() => jest.restoreAllMocks());

const calls = (topic: string): any[] =>
  mockApp.mutate.mock.calls.filter((call: any[]) => call[0] === topic);

test('a tapped name is edited in place; 완료 saves it once', async () => {
  await render(<TaskDetailScreen />);
  await fireEvent.press(screen.getByText('숙소 체크인 시간 문의'));
  const input = screen.getByDisplayValue('숙소 체크인 시간 문의');
  expect(input.props.multiline).toBe(true);
  await fireEvent.changeText(input, '  숙소 체크인 3시로 확인  ');
  const onBlur = input.props.onBlur;
  await fireEvent(input, 'submitEditing');
  // The blur that follows 완료 does not save again.
  await act(async () => onBlur());
  expect(calls('task/updateSubtaskTitle')).toEqual([
    ['task/updateSubtaskTitle', ['t1', 'b', '숙소 체크인 3시로 확인']],
  ]);
  expect(screen.queryByDisplayValue(/숙소/)).toBeNull();
});

test('a tap elsewhere (blur) saves; an unchanged or emptied name sends nothing', async () => {
  await render(<TaskDetailScreen />);
  await fireEvent.press(screen.getByText('짐 싸기'));
  await fireEvent.changeText(screen.getByDisplayValue('짐 싸기'), '짐 싸기 (우비)');
  await fireEvent(screen.getByDisplayValue('짐 싸기 (우비)'), 'blur');
  expect(calls('task/updateSubtaskTitle')).toEqual([
    ['task/updateSubtaskTitle', ['t1', 'c', '짐 싸기 (우비)']],
  ]);

  mockApp.mutate.mockClear();
  await fireEvent.press(screen.getByText('항공권 예매 확인'));
  await fireEvent(screen.getByDisplayValue('항공권 예매 확인'), 'blur');
  await fireEvent.press(screen.getByText('항공권 예매 확인'));
  const emptied = screen.getByDisplayValue('항공권 예매 확인');
  await fireEvent.changeText(emptied, '   ');
  await fireEvent(emptied, 'blur');
  expect(calls('task/updateSubtaskTitle')).toEqual([]);
  // The name it had is back.
  expect(screen.getByText('항공권 예매 확인')).toBeTruthy();
});

test('another device renames a row: shown unless that row is being edited', async () => {
  const view = await render(<TaskDetailScreen />);
  mockApp.model = modelWith([
    { ...SUBS[0], title: '항공권 다시 확인' },
    ...SUBS.slice(1),
  ]);
  await view.rerender(<TaskDetailScreen />);
  expect(screen.getByText('항공권 다시 확인')).toBeTruthy();

  await fireEvent.press(screen.getByText('짐 싸기'));
  await fireEvent.changeText(screen.getByDisplayValue('짐 싸기'), '짐 싸기!');
  mockApp.model = modelWith([
    SUBS[0],
    SUBS[1],
    { ...SUBS[2], title: '짐 다 싸기' },
  ]);
  await view.rerender(<TaskDetailScreen />);
  expect(screen.getByDisplayValue('짐 싸기!')).toBeTruthy();
});

test('X deletes right away; 되돌리기 restores it in the same place within 5 seconds', async () => {
  jest.useFakeTimers();
  try {
    await render(<TaskDetailScreen />);
    const xs = screen.getAllByLabelText('하위 할 일 삭제');
    await fireEvent.press(xs[0]);
    expect(calls('task/deleteSubtask')).toEqual([
      ['task/deleteSubtask', ['t1', 'a']],
    ]);
    expect(screen.getByText('하위 할 일을 삭제했어요')).toBeTruthy();
    await fireEvent.press(screen.getByText('되돌리기'));
    expect(calls('task/restoreSubtask')).toEqual([
      [
        'task/restoreSubtask',
        [
          't1',
          { title: '항공권 예매 확인', done: true, created_at: 10, done_at: 50 },
          { prevId: null, nextId: 'b' },
        ],
      ],
    ]);
    expect(screen.queryByText('하위 할 일을 삭제했어요')).toBeNull();

    // The middle one: its neighbours; the notice goes after UNDO_MS.
    await fireEvent.press(screen.getAllByLabelText('하위 할 일 삭제')[1]);
    expect(screen.getByText('하위 할 일을 삭제했어요')).toBeTruthy();
    await act(async () => {
      jest.advanceTimersByTime(UNDO_MS - 100);
    });
    expect(screen.getByText('되돌리기')).toBeTruthy();
    await act(async () => {
      jest.advanceTimersByTime(200);
    });
    expect(screen.queryByText('되돌리기')).toBeNull();
    expect(calls('task/restoreSubtask')).toHaveLength(1);
  } finally {
    jest.useRealTimers();
  }
});

test('the add field adds on 완료 (and stays), on a tap elsewhere and when the keyboard goes away', async () => {
  await render(<TaskDetailScreen />);
  const add = screen.getByPlaceholderText('하위 할 일 추가');
  await fireEvent(add, 'focus');
  await fireEvent.changeText(add, '우비 사기');
  await fireEvent(add, 'submitEditing');
  expect(add.props.value).toBe('');
  await fireEvent.changeText(add, '환전하기');
  await fireEvent(add, 'blur');
  await fireEvent(add, 'blur');
  // Android back: the keyboard hides while the field keeps the focus.
  await fireEvent(add, 'focus');
  await fireEvent.changeText(add, '충전기 챙기기');
  await act(async () => keyboard.keyboardDidHide());
  await fireEvent(add, 'blur');
  // Nothing typed: nothing added.
  await fireEvent(add, 'focus');
  await fireEvent(add, 'blur');
  expect(calls('task/createSubtask').map((call: any) => call[1][0].title)).toEqual([
    '우비 사기',
    '환전하기',
    '충전기 챙기기',
  ]);
  expect(calls('task/createSubtask')[0][1][1]).toBe('t1');
});

// Rows 40 high from y 0 in the list.
async function laidOut() {
  for (const [i, s] of SUBS.entries())
    await fireEvent(screen.getByTestId(`subtask-${s.sid}`), 'layout', {
      nativeEvent: { layout: { x: 0, y: i * 40, width: 390, height: 40 } },
    });
}
const list = () => screen.getByTestId('subtask-list');
const order = () =>
  screen
    .getAllByText(/항공권 예매 확인|숙소 체크인 시간 문의|짐 싸기/)
    .map(node => node.props.children);

test('hold a row and drag it: the list follows, the drop sends the anchor', async () => {
  await render(<TaskDetailScreen />);
  await laidOut();
  await fireEvent(screen.getByText('항공권 예매 확인'), 'longPress', {
    nativeEvent: { pageY: 300 },
  });
  // Lifted: the list takes the touch and the screen does not scroll.
  expect(list().props.onMoveShouldSetResponderCapture()).toBe(true);
  expect(list().props.onResponderGrant()).toBe(true);
  await fireEvent(list(), 'responderMove', { nativeEvent: { pageY: 345 } });
  expect(order()).toEqual(['숙소 체크인 시간 문의', '항공권 예매 확인', '짐 싸기']);
  await fireEvent(list(), 'responderMove', { nativeEvent: { pageY: 390 } });
  expect(order()).toEqual(['숙소 체크인 시간 문의', '짐 싸기', '항공권 예매 확인']);
  await fireEvent(list(), 'responderRelease');
  expect(calls('task/updateSubtaskOrder')).toEqual([
    ['task/updateSubtaskOrder', ['t1', 'a', 'c', true]],
  ]);
  expect(list().props.onMoveShouldSetResponderCapture()).toBe(false);
  // Shown in the synced order again (this fake model does not apply the move).
  expect(order()).toEqual(['항공권 예매 확인', '숙소 체크인 시간 문의', '짐 싸기']);
});

test('a lift dropped in place sends nothing; a short tap still edits and the check still toggles', async () => {
  await render(<TaskDetailScreen />);
  await laidOut();
  const name = screen.getByText('짐 싸기');
  await fireEvent(name, 'longPress', { nativeEvent: { pageY: 100 } });
  await fireEvent(name, 'pressOut');
  expect(calls('task/updateSubtaskOrder')).toEqual([]);
  expect(list().props.onMoveShouldSetResponderCapture()).toBe(false);

  await fireEvent.press(screen.getAllByRole('checkbox')[2]);
  expect(calls('task/updateSubtaskDone')[0][1].slice(0, 3)).toEqual(['t1', 'b', true]);
  await fireEvent.press(screen.getByText('짐 싸기'));
  expect(screen.getByDisplayValue('짐 싸기')).toBeTruthy();
});

test('no lifting while a field has the keyboard', async () => {
  await render(<TaskDetailScreen />);
  await laidOut();
  await fireEvent(screen.getByPlaceholderText('하위 할 일 추가'), 'focus');
  await act(async () => keyboard.keyboardDidShow());
  const name = screen.getByText('숙소 체크인 시간 문의');
  await fireEvent(name, 'longPress', { nativeEvent: { pageY: 100 } });
  expect(list().props.onMoveShouldSetResponderCapture()).toBe(false);
});

test('drop index and anchors (same rule as the PC), read against the rows there are now', () => {
  expect(dropIndex([20, 60], 10)).toBe(0);
  expect(dropIndex([20, 60], 40)).toBe(1);
  expect(dropIndex([20, 60], 70)).toBe(2);
  const now = ['a', 'b', 'c'];
  expect(dropAnchor(now, ['a', 'b', 'c'], 'a')).toBeNull();
  expect(dropAnchor(now, ['b', 'a', 'c'], 'a')).toEqual({ anchorId: 'c', after: false });
  expect(dropAnchor(now, ['b', 'c', 'a'], 'a')).toEqual({ anchorId: 'c', after: true });
  expect(dropAnchor(now, ['c', 'a', 'b'], 'c')).toEqual({ anchorId: 'a', after: false });
  // Deleted meanwhile: the anchor is never a row that is gone; a gone row is not moved.
  expect(dropAnchor(['a', 'b'], ['b', 'a', 'c'], 'a')).toEqual({ anchorId: 'b', after: true });
  expect(dropAnchor(['b', 'c'], ['b', 'c', 'a'], 'a')).toBeNull();
  // Added meanwhile: stays at the end.
  expect(dropAnchor(['a', 'b', 'c', 'd'], ['b', 'a', 'c'], 'a')).toEqual({ anchorId: 'c', after: false });
});

test('rows deleted on another device during a drag: the drop uses the rows left and never throws', async () => {
  const view = await render(<TaskDetailScreen />);
  await laidOut();
  await fireEvent(screen.getByText('항공권 예매 확인'), 'longPress', {
    nativeEvent: { pageY: 300 },
  });
  await fireEvent(list(), 'responderMove', { nativeEvent: { pageY: 390 } });
  // The anchor it would have used (c) is deleted meanwhile.
  mockApp.model = modelWith(SUBS.slice(0, 2));
  await view.rerender(<TaskDetailScreen />);
  await fireEvent(list(), 'responderRelease');
  expect(calls('task/updateSubtaskOrder')).toEqual([
    ['task/updateSubtaskOrder', ['t1', 'a', 'b', true]],
  ]);

  // The lifted row itself is deleted: nothing is sent.
  mockApp.mutate.mockClear();
  mockApp.model = modelWith(SUBS);
  await view.rerender(<TaskDetailScreen />);
  await laidOut();
  await fireEvent(screen.getByText('짐 싸기'), 'longPress', {
    nativeEvent: { pageY: 300 },
  });
  await fireEvent(list(), 'responderMove', { nativeEvent: { pageY: 200 } });
  mockApp.model = modelWith(SUBS.slice(0, 2));
  await view.rerender(<TaskDetailScreen />);
  await fireEvent(list(), 'responderRelease');
  expect(calls('task/updateSubtaskOrder')).toEqual([]);

  // The model refuses the move (ANCHOR_DELETED): no crash.
  mockApp.model = modelWith(SUBS);
  await view.rerender(<TaskDetailScreen />);
  await laidOut();
  mockApp.mutate.mockImplementationOnce(() => {
    throw Error('ANCHOR_DELETED');
  });
  await fireEvent(screen.getByText('항공권 예매 확인'), 'longPress', {
    nativeEvent: { pageY: 300 },
  });
  await fireEvent(list(), 'responderMove', { nativeEvent: { pageY: 390 } });
  await fireEvent(list(), 'responderRelease');
  expect(list().props.onMoveShouldSetResponderCapture()).toBe(false);
});

test('the system taking the touch cancels the drag: the order goes back, nothing is saved', async () => {
  await render(<TaskDetailScreen />);
  await laidOut();
  await fireEvent(screen.getByText('항공권 예매 확인'), 'longPress', {
    nativeEvent: { pageY: 300 },
  });
  await fireEvent(list(), 'responderMove', { nativeEvent: { pageY: 390 } });
  expect(order()).toEqual(['숙소 체크인 시간 문의', '짐 싸기', '항공권 예매 확인']);
  await fireEvent(list(), 'responderTerminate');
  expect(calls('task/updateSubtaskOrder')).toEqual([]);
  expect(order()).toEqual(['항공권 예매 확인', '숙소 체크인 시간 문의', '짐 싸기']);
  expect(list().props.onMoveShouldSetResponderCapture()).toBe(false);
});

// Lays out the rows shown (40 high each), holds the first one and reports whether it lifted.
async function canDrag() {
  const rows = screen.getAllByTestId(/^subtask-[a-z]$/);
  for (const [i, row] of rows.entries())
    await fireEvent(row, 'layout', {
      nativeEvent: { layout: { x: 0, y: i * 40, width: 390, height: 40 } },
    });
  const first = screen.getByText('항공권 예매 확인');
  await fireEvent(first, 'longPress', { nativeEvent: { pageY: 300 } });
  const lifted = list().props.onMoveShouldSetResponderCapture();
  await fireEvent(first, 'pressOut');
  return lifted;
}

test('deleting the row being edited (here or elsewhere) ends the edit; lifting works again', async () => {
  const view = await render(<TaskDetailScreen />);
  await fireEvent.press(screen.getByText('짐 싸기'));
  await fireEvent(screen.getByDisplayValue('짐 싸기'), 'focus');
  await fireEvent.press(screen.getAllByLabelText('하위 할 일 삭제')[2]);
  expect(await canDrag()).toBe(true);

  // Another device deletes the row while it is edited.
  await fireEvent.press(screen.getByText('숙소 체크인 시간 문의'));
  await fireEvent(screen.getByDisplayValue('숙소 체크인 시간 문의'), 'focus');
  expect(await canDrag()).toBe(false);
  mockApp.model = modelWith([SUBS[0], SUBS[2]]);
  await view.rerender(<TaskDetailScreen />);
  expect(screen.queryByDisplayValue('숙소 체크인 시간 문의')).toBeNull();
  expect(await canDrag()).toBe(true);
});

test.each(['title', 'memo', 'sub'])(
  'the keyboard going away (Android back) ends the %s field; lifting works again',
  async field => {
    await render(<TaskDetailScreen />);
    if (field === 'title')
      await fireEvent(screen.getByDisplayValue('제주 여행 준비'), 'focus');
    else if (field === 'memo')
      await fireEvent(screen.getByPlaceholderText('메모할 내용을 적어주세요.'), 'focus');
    else {
      await fireEvent.press(screen.getByText('짐 싸기'));
      await fireEvent(screen.getByDisplayValue('짐 싸기'), 'focus');
    }
    await act(async () => keyboard.keyboardDidShow());
    expect(await canDrag()).toBe(false);
    await act(async () => keyboard.keyboardDidHide());
    if (field === 'sub') {
      // The test renderer has no native blur: the edit ends on the blur event it sends.
      const input = screen.queryByDisplayValue('짐 싸기');
      if (input) await fireEvent(input, 'blur');
    }
    expect(await canDrag()).toBe(true);
  },
);
