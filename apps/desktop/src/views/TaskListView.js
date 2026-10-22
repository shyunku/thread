import "./TaskListView.scss";
import { useMemo, useState } from "react";
import TaskRow from "components/list/TaskRow";
import { listSections, memoSnippet, searchSections } from "components/list/listModel";
import useClock from "hooks/UseClock";
import { ChevIcon, ShieldIcon } from "molecules/pickers/icons";

const DONE_PAGE = 50;
const dayOf = (now) => new Date(now).setHours(0, 0, 0, 0);

// A group: the heading on the background (name, count, fold arrow) and its rows in one box.
function Section({ id, name, count, over, closed, onFold, children, footer }) {
  return (
    <section className="tl-group" data-group={id}>
      <button
        type="button"
        className={"tl-sec" + (over ? " over" : "")}
        aria-expanded={!closed}
        aria-label={`${name} ${count}개`}
        onClick={() => onFold(id, !closed)}
      >
        <span className="tl-nm">{name}</span>
        <span className="tl-c">{count}</span>
        <span className="tl-tog" data-tip={closed ? "펼치기" : "접기"}><ChevIcon open={!closed} /></span>
      </button>
      {!closed && <div className="tl-box" role="listbox" aria-label={name}>{children}</div>}
      {!closed && footer}
    </section>
  );
}

// The list body (#102 mock listBody): date groups (or one 해야 할 일 box) and 완료됨, the search
// results, the empty and locked states. It is the scroll container; folding keeps the scroll
// position (overflow-anchor off) and the bottom keeps 80px free above the quick add.
// tasks: the screen's tasks (secret ones already filtered) in stored order; in search, the tasks
// searched (results: their searchSections, when the caller has them already).
// prefs: group, noneTop, sort, density, hideDone, groupClosed, weekStart and the time formats.
// row: { catsOf(task), selectedId, onSelect, onToggleDone, onToggleStar, onMenu, onKeyDown,
//   isHidden(task) (search hits in hidden secret categories), unlocked, onUnlock(task) }.
// Search wins over the locked state (a locked category screen still shows the results).
export default function TaskListView({
  tasks = [], prefs = {}, onFold, row = {}, query = "", search = false, results = null, categoryName, locked = null,
  emptyTitle = "할 일이 없어요",
}) {
  const day = useClock(dayOf);
  const [doneLimit, setDoneLimit] = useState(DONE_PAGE);
  const [searchClosed, setSearchClosed] = useState({});
  const { group, noneTop, sort, hideDone, weekStart, density } = prefs;
  const closed = prefs.groupClosed ?? { done: true };
  const timeOptions = useMemo(
    () => ({ showRemain: prefs.showRemain, remainFormat: prefs.remainFormat, dueFormat: prefs.dueFormat, timeFormat: prefs.timeFormat }),
    [prefs.showRemain, prefs.remainFormat, prefs.dueFormat, prefs.timeFormat]
  );
  const sections = useMemo(
    () => (search || locked ? [] : listSections(tasks, { now: Math.max(Date.now(), day), weekStart, group, noneTop, sort, hideDone })),
    [tasks, day, weekStart, group, noneTop, sort, hideDone, search, locked]
  );
  const found = useMemo(
    () => (search ? results ?? searchSections(tasks, query, categoryName, { hideDone }) : null),
    [search, results, tasks, query, categoryName, hideDone]
  );

  const rowOf = (task, extra) => {
    const hidden = search && !!row.isHidden?.(task);
    return (
      <TaskRow
        key={task.id}
        task={task}
        catsOf={row.catsOf}
        selected={row.selectedId === task.id}
        hidden={hidden}
        needsUnlock={hidden && !row.unlocked}
        onUnlock={row.onUnlock}
        compact={density === "compact"}
        timeOptions={timeOptions}
        onSelect={row.onSelect}
        onToggleDone={row.onToggleDone}
        onToggleStar={row.onToggleStar}
        onMenu={row.onMenu}
        onKeyDown={row.onKeyDown}
        {...extra}
      />
    );
  };

  let body;
  if (locked && !search) {
    body = (
      <div className="tl-locked">
        <div className="tl-ic" style={{ color: locked.color }}><ShieldIcon size={22} /></div>
        <b>이 카테고리는 잠겨 있어요</b>
        <span className="tl-one">열면 할 일이 보이고, 앱을 닫거나 잠그면 다시 잠겨요.</span>
        <br />
        <button type="button" className="tl-btn pri" onClick={locked.onUnlock}>{locked.label}</button>
      </div>
    );
  } else if (search) {
    const parts = [["s-title", "제목에서", found.title, {}], ["s-memo", "메모에서", found.memo, { snippet: true }], ["s-cat", "카테고리에서", found.category, {}]];
    const total = found.title.length + found.memo.length + found.category.length;
    const hiddenCount = row.isHidden ? [...found.title, ...found.memo, ...found.category].filter((t) => row.isHidden(t)).length : 0;
    body = (
      <div className="tl-search">
        {parts.map(([id, name, list, opts]) => list.length > 0 && (
          <Section key={id} id={id} name={name} count={list.length} closed={!!searchClosed[id]} onFold={(sid, c) => setSearchClosed((s) => ({ ...s, [sid]: c }))}>
            {list.map((task) => rowOf(task, { query, snippet: opts.snippet ? memoSnippet(task.memo, query) : null }))}
          </Section>
        ))}
        {total === 0 && <div className="tl-empty"><b>찾는 할 일이 없어요</b>다른 말로 찾아보세요.</div>}
        <p className="tl-sum">
          제목 {found.title.length}개 · 메모 {found.memo.length}개 · 카테고리 {found.category.length}개{hiddenCount > 0 && ` · 숨김 ${hiddenCount}개 포함`}
        </p>
      </div>
    );
  } else {
    const done = sections.find((s) => s.id === "done");
    const open = sections.filter((s) => s.id !== "done");
    const doneSection = done && (
      <Section
        key="done"
        id="done"
        name={done.name}
        count={done.tasks.length}
        closed={!!closed.done}
        onFold={onFold}
        footer={done.tasks.length > doneLimit && (
          <button type="button" className="tl-more" onClick={() => setDoneLimit((n) => n + DONE_PAGE)}>완료한 할 일 더 보기</button>
        )}
      >
        {done.tasks.slice(0, doneLimit).map((task) => rowOf(task))}
      </Section>
    );
    body = (
      <>
        {open.length === 0 && (
          <div className="tl-empty">
            <b>{emptyTitle}</b>
            아래 입력칸에서 바로 추가할 수 있어요.
            {done && closed.done && (
              <>
                <br />
                <button type="button" className="tl-btn" onClick={() => onFold("done", false)}>완료한 할 일 {done.tasks.length}개 보기</button>
              </>
            )}
          </div>
        )}
        {open.map((s) => (
          <Section key={s.id} id={s.id} name={s.name} count={s.tasks.length} over={s.over} closed={!!closed[s.id]} onFold={onFold}>
            {s.tasks.map((task) => rowOf(task))}
          </Section>
        ))}
        {doneSection && (open.length > 0 || !closed.done) && doneSection}
      </>
    );
  }

  return <div className="task-view list tc-scroll">{body}</div>;
}
