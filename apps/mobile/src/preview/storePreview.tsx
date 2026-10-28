import { useMemo, useState, type ReactNode } from 'react';
import { LogBox } from 'react-native';
import { AppContext, type AppValue } from '@/app/AppContext';
import { buildModel, type Lists, type Scope } from '@/core/model/view';
import { APP_VERSION } from '@/core/patchNotes';
import { defaultPrefs, type Prefs } from '@/core/prefs';

// Dev-only screens with synthetic tasks for store screenshots (#92), like the desktop
// `#/__app-preview`. Turned on by STORE_PREVIEW=1 in a debug build; release builds never
// include it (App.tsx requires this file only under __DEV__). No server, no vault: edits
// do nothing.

const DAY = 86400000;
function at(days: number, hour: number, minute = 0) {
  const d = new Date(Date.now() + days * DAY);
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
}
const inHours = (hours: number) =>
  Math.ceil((Date.now() + hours * 3600000) / 3600000) * 3600000;

export function previewLists(): Lists {
  const categories = [
    { cid: 'work', title: '업무', color: '#6294ff', secret: false },
    { cid: 'study', title: '공부', color: '#b58cff', secret: false },
    { cid: 'life', title: '생활', color: '#44c98b', secret: false },
    { cid: 'diary', title: '일기', color: '#e57ad6', secret: true },
  ].map((c, i) => ({
    ...c,
    created_at: at(-30, 9) + i * 60000,
    sort_rank: String((i + 1) * 4294967296),
  }));
  const tasks: any[] = [
    {
      tid: 't1',
      title: '분기 회고 자료 정리',
      due: inHours(3),
      cats: ['work'],
      memo: '지난 분기 지표와 다음 목표 3가지',
      important: true,
    },
    {
      tid: 't2',
      title: '디자인 리뷰 피드백 반영',
      due: at(1, 11),
      cats: ['work'],
      important: true,
    },
    {
      tid: 't3',
      title: '운동 30분',
      due: inHours(5),
      cats: ['life'],
      repeat: 'day',
    },
    {
      tid: 't4',
      title: '알고리즘 문제 2개 풀기',
      due: at(2, 22),
      cats: ['study'],
    },
    {
      tid: 't5',
      title: '영어 회화 스터디 준비',
      due: at(4, 19),
      cats: ['study'],
    },
    { tid: 't6', title: '주간 장보기', due: at(5, 15), cats: ['life'] },
    {
      tid: 't7',
      title: '릴리스 노트 작성',
      due: at(-1, 18),
      cats: ['work'],
      done: true,
    },
    {
      tid: 't8',
      title: '치과 예약',
      due: at(9, 10),
      cats: ['life'],
      important: true,
    },
    { tid: 't9', title: '여행 숙소 알아보기', due: at(1, 20), cats: [] },
    { tid: 't12', title: '주간 보고서 제출', due: at(-1, 18), cats: ['work'] },
    { tid: 't13', title: '책장 정리', due: null, cats: [] },
    {
      tid: 's1',
      title: '병원 검사 결과 정리',
      due: at(1, 10),
      cats: ['diary'],
    },
  ];
  return {
    categories,
    tasks: tasks.map((t, i) => ({
      tid: t.tid,
      title: t.title,
      memo: t.memo || '',
      due_date: t.due || 0,
      done: !!t.done,
      done_at: t.done ? at(-1, 17) : null,
      repeat_period: t.repeat || null,
      repeat_start_at: t.repeat ? t.due : null,
      important: !!t.important,
      created_at: at(-7, 9) + i * 60000,
      updated_at: at(0, 10),
      sort_rank: String((i + 1) * 4294967296),
      next: tasks[i + 1]?.tid || null,
    })),
    subtasks: [
      {
        sid: 'u1',
        tid: 't1',
        title: '매출 지표 정리',
        done: true,
        done_at: at(0, 10),
        due_date: null,
        created_at: at(-2, 9),
      },
      {
        sid: 'u2',
        tid: 't1',
        title: '팀 피드백 요약',
        done: true,
        done_at: at(0, 11),
        due_date: null,
        created_at: at(-2, 9),
      },
      {
        sid: 'u3',
        tid: 't1',
        title: '다음 분기 목표 초안',
        done: false,
        done_at: null,
        due_date: at(1, 18),
        created_at: at(-2, 9),
      },
      {
        sid: 'u4',
        tid: 't2',
        title: '온보딩 화면 문구',
        done: false,
        done_at: null,
        due_date: null,
        created_at: at(-1, 9),
      },
    ],
    relations: tasks.flatMap(t =>
      t.cats.map((cid: string) => ({ tid: t.tid, cid })),
    ),
  };
}

const noop = () => {};
// Dev warning toasts would cover the screenshots.
LogBox.ignoreAllLogs(true);

export function StorePreviewProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefsState] = useState<Prefs>({
    ...defaultPrefs,
    theme: 'dark',
    notifyAsked: true,
    // No after-update window over the screenshots.
    patchNotesSeen: APP_VERSION,
  });
  const [scope, setScope] = useState<Scope>({ kind: 'all' });
  const model = useMemo(() => buildModel(previewLists()), []);
  const value = {
    runtime: {
      prefs: { load: () => prefs, save: noop },
      reminders: { schedule: noop, askPermission: () => Promise.resolve(true) },
    } as any,
    ready: true,
    user: { uid: 'preview', username: 'Thread', authId: 'thread' } as any,
    account: null,
    phase: 'UNLOCKED',
    setup: 'READY',
    sync: {
      phase: 'ACTIVE',
      connected: true,
      syncing: false,
      pending: 0,
      conflicts: 0,
      lastSyncedAt: Date.now(),
      error: null,
    } as any,
    model,
    prefs,
    setPrefs: (patch: Partial<Prefs>) =>
      setPrefsState(p => ({ ...p, ...patch })),
    refresh: noop,
    mutate: () => null,
    setupDone: noop,
    reloadSetup: noop,
    scope,
    setScope: async (next: Scope) => {
      setScope(next);
      return true;
    },
    isSecretOpen: () => true,
    notice: null,
    clearNotice: noop,
  } as AppValue;
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
