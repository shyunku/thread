// Development-only #/__app-preview: the main window filled with synthetic tasks,
// used for website screenshots. No account, keys, files or main process involved.
import { useMemo, useState } from "react";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";
import TopBar from "../components/TopBar";
import HomeLayout from "../layouts/Home.layout";
import Home from "../pages/Home";
import { fromSyncV2View } from "../utils/syncV2View";

const DAY = 86400000;

function at(days, hour, minute = 0) {
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  return date.getTime() + days * DAY;
}

const inHours = (hours) => Date.now() + hours * 3600000;

// Filler tasks for count=<n> (#101 tick cost): due times spread from ~1 day ago to ~12 days ahead.
function fillerTasks(count) {
  const cats = ["work", "study", "life"];
  return Array.from({ length: Math.max(0, count) }, (_, i) => ({
    tid: `f${i}`, title: `샘플 할 일 ${i + 1}`, due: Date.now() + (((i * 7919) % 20000) - 2000) * 61000 + (i % 60) * 1000,
    cats: i % 4 === 3 ? [] : [cats[i % 3]], important: i % 7 === 0, repeat: i % 11 === 0 ? "day" : undefined,
  }));
}

// long=1 adds a long title and a long category name (ellipsis checks);
// count=<n> fills the list up to n tasks.
function previewView(long = false, count = 0) {
  const categories = [
    { cid: "work", title: "업무", color: "#6294ff", secret: false, locked: false, created_at: at(-30, 9) },
    { cid: "study", title: "공부", color: "#b58cff", secret: false, locked: false, created_at: at(-30, 9) },
    { cid: "life", title: "생활", color: "#44c98b", secret: false, locked: false, created_at: at(-30, 9) },
    ...(long ? [{ cid: "exam", title: "자격증 및 어학 시험 준비 (2026 하반기)", color: "#f0838b", secret: false, locked: false, created_at: at(-30, 9) }] : []),
  ];
  const tasks = [
    { tid: "t1", title: "분기 회고 자료 정리", due: inHours(3), cats: ["work"], memo: "지난 분기 지표와 다음 목표 3가지", important: true },
    { tid: "t2", title: "디자인 리뷰 피드백 반영", due: at(1, 11), cats: ["work"], important: true },
    { tid: "t9", title: "여행 숙소 알아보기", due: at(1, 20), cats: [] },
    ...(long ? [
      { tid: "t10", title: "다음 주 월요일 회의 전까지 분기별 마케팅 성과 보고서 초안 작성해서 팀에 공유하기", due: at(3, 18), cats: ["work"] },
      { tid: "t11", title: "토익 단어 50개", due: at(3, 21), cats: ["exam"], repeat: "day" },
    ] : []),
    { tid: "t3", title: "운동 30분", due: inHours(5), cats: ["life"], repeat: "day" },
    { tid: "t4", title: "알고리즘 문제 2개 풀기", due: at(2, 22), cats: ["study"] },
    { tid: "t5", title: "영어 회화 스터디 준비", due: at(4, 19), cats: ["study"] },
    { tid: "t6", title: "주간 장보기", due: at(5, 15), cats: ["life"] },
    { tid: "t7", title: "릴리스 노트 작성", due: at(-1, 18), cats: ["work"], done: true },
    { tid: "t8", title: "치과 예약", due: at(9, 10), cats: ["life"], important: true },
  ];
  tasks.push(...fillerTasks(count - tasks.length));
  return {
    categories,
    tasks: tasks.map((task, index) => ({
      tid: task.tid, title: task.title, memo: task.memo || "", due_date: task.due,
      done: !!task.done, done_at: task.done ? at(-1, 17) : null,
      repeat_period: task.repeat || null, repeat_start_at: task.repeat ? task.due : null,
      created_at: at(-7, 9), next: tasks[index + 1]?.tid || null, important: !!task.important,
    })),
    subtasks: [
      { sid: "s1", tid: "t1", title: "매출 지표 정리", done: true, done_at: at(0, 10), due_date: null, created_at: at(-2, 9) },
      { sid: "s2", tid: "t1", title: "팀 피드백 요약", done: true, done_at: at(0, 11), due_date: null, created_at: at(-2, 9) },
      { sid: "s3", tid: "t1", title: "다음 분기 목표 초안", done: false, done_at: null, due_date: null, created_at: at(-2, 9) },
      { sid: "s4", tid: "t2", title: "온보딩 화면 문구", done: false, done_at: null, due_date: null, created_at: at(-1, 9) },
      { sid: "s5", tid: "t2", title: "아이콘 크기 통일", done: false, done_at: null, due_date: null, created_at: at(-1, 9) },
    ],
    relations: tasks.flatMap((task) => task.cats.map((cid) => ({ tid: task.tid, cid }))),
  };
}

// update=<status> (available, downloading, installing, failed, ready) shows a synthetic
// pending update in the title bar and the update dialog (#100 screenshots).
export function installAppPreviewIpc(IpcSender, params = new URLSearchParams()) {
  const ok = (data) => (...args) => args.find((arg) => typeof arg === "function")?.({ success: true, data });
  IpcSender.req = new Proxy({}, { get: () => new Proxy({}, { get: () => ok([]) }) });
  IpcSender.onAll = (_topic, listener) => listener;
  IpcSender.offAll = () => {};
  IpcSender.off = () => {};
  IpcSender.system = new Proxy({}, { get: (_, name) => (name === "isMaximizable" ? ok(true) : () => {}) });
  const status = params.get("update");
  const update = status ? { version: "2.0.10", mandatory: params.get("mandatory") === "1", status, autoInstall: ["downloading", "installing"].includes(status) } : null;
  IpcSender.releaseAlerts = { get: ok(update), update: () => {}, cancel: () => {} };
}

function PreviewRoot() {
  const states = useMemo(() => {
    const params = new URLSearchParams(window.location.hash.split("?")[1] || "");
    return fromSyncV2View(previewView(params.get("long") === "1", Number(params.get("count")) || 0));
  }, []);
  const [searchQuery, setSearchQuery] = useState("");
  return (
    <div className="root-layout">
      <TopBar searchQuery={searchQuery} setSearchQuery={setSearchQuery} />
      <div className="root-layout__content">
        <Outlet context={{ localNonce: 0, remoteNonce: 0, addPromise: () => {}, states, searchQuery }} />
      </div>
    </div>
  );
}

export default function AppPreview() {
  return (
    <MemoryRouter>
      <Routes>
        <Route element={<PreviewRoot />}>
          <Route element={<HomeLayout />}>
            <Route path="*" element={<Home />} />
          </Route>
        </Route>
      </Routes>
    </MemoryRouter>
  );
}
