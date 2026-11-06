import "./TodoContent.scss";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useOutletContext } from "react-router-dom";
import { v4 } from "uuid";
import { TODO_MENU_LABEL, TODO_MENU_TYPE, inMenu, isMenuType, isOverdue, isSecretTask } from "utils/menuFilters";
import { osAuthName, useSecretSession } from "../hooks/useSecretSession";
import Task from "objects/Task";
import TaskListView from "views/TaskListView";
import IpcSender from "utils/IpcSender";
import Subtask from "objects/Subtask";
import moment from "moment";
import Category from "objects/Category";
import TaskCalendarView from "views/TaskCalendarView";
import TaskTimelineView from "views/TaskTimelineView";
import Toast from "molecules/Toast";
import { START_VIEWS, prefsSelector, setPrefs } from "store/prefsSlice";
import useClock from "hooks/UseClock";
import { CategoryPicker, TaskContextMenu, openPopupCount } from "molecules/pickers";
import { moveFocus } from "molecules/pickers/focusNav";
import { categoryColor } from "utils/categoryColors";
import { sortCategories, sortSubtasks } from "utils/categoryOrder";
import { dueMs } from "utils/timeDisplay";
import { PanelHost, useHomeLayout } from "layouts/homeLayoutContext";
import ListHeader from "./list/ListHeader";
import RightPanel, { PanelOpenButton } from "./panel/RightPanel";
import { PickedDayContext, startOfDay } from "./panel/pickedDay";
import QuickAdd, { quickAddDefaults } from "./list/QuickAdd";
import { searchSections, storedOrder } from "./list/listModel";
import { TaskSelectionContext } from "./list/taskSelection";
import useTaskCompletion, { forgetRolled, markRolled, restoreRow, riseAway } from "./list/useTaskCompletion";
import UndoNotice from "./UndoNotice";
import useUndoNotice from "./useUndoNotice";

const isEditable = (el) =>
  el instanceof Element && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

// The answer callback for a change: a refusal is final (the main process already waited for a
// busy vault), so it says so. A busy vault gets the "try again" hint.
const failed = (message) => ({ success, data } = {}) => {
  if (success === false) Toast.error(data?.code === "VAULT_BUSY" ? `${message} 잠시 뒤에 다시 해 주세요.` : message);
};
// The answer of a change with an undo notice: the notice learns it (a refused change has none),
// and a refusal says so as above.
const settled = (settle, message) => (reply = {}) => {
  settle(reply.success !== false);
  failed(message)(reply);
};
const undoFailed = failed("되돌리지 못했어요.");

// A deleted task as task/restoreTask takes it back: its fields, categories, subtasks in the shown
// order and its neighbours in the stored order (`list`). It comes back with a new id.
function restoreSnapshot(task, list) {
  const i = list.indexOf(task);
  return {
    ...task.toEntity(),
    tid: v4(),
    categories: Object.keys(task.categories ?? {}),
    subtasks: sortSubtasks(Object.values(task.subtasks ?? {})).map((s) => s.toEntity()),
    prevId: list[i - 1]?.id ?? null,
    nextId: list[i + 1]?.id ?? null,
  };
}

// The selection and the picked day, for the list, the views and the right panel.
const ScreenContexts = ({ selection, pickedDay, children }) => (
  <TaskSelectionContext.Provider value={selection}>
    <PickedDayContext.Provider value={pickedDay}>{children}</PickedDayContext.Provider>
  </TaskSelectionContext.Provider>
);

// children render inside the selection context, next to the main pane (the right panel, phase F).
const TodoContent = ({ children }) => {
  const props = useOutletContext();
  const {
    selectedTodoMenuType,
    category,
    addPromise,
    states,
    searchQuery = "",
    syncStatus,
  } = props;

  const { taskMap, categories } = states;
  const dispatch = useDispatch();
  const prefs = useSelector(prefsSelector);
  const layout = useHomeLayout();

  // The one selected task (#102); phase F's right panel reads it through useTaskSelection().
  const [selectedTaskId, setSelectedTaskId] = useState(null);
  const [menu, setMenu] = useState(null); // task menu: { taskId, point, row }
  const [newCategoryFor, setNewCategoryFor] = useState(null); // { taskId, point }
  // Initial view follows 설정 > 일반 > 시작할 때 보기; every menu can switch (#102).
  const [view, setView] = useState(() => (START_VIEWS.includes(prefs.startView) ? prefs.startView : "list"));
  // The picked day of the calendar view and the panel's calendar tab (usePickedDay). It follows
  // today (also past midnight) until the user picks another day.
  const today = useClock((now) => startOfDay(now));
  const [userPick, setUserPick] = useState(null);
  const pickedDay = userPick ?? today;
  const setPickedDay = useCallback((day) => {
    const ms = startOfDay(day);
    setUserPick(ms === startOfDay(Date.now()) ? null : ms);
  }, []);
  const pickedDayValue = useMemo(() => ({ pickedDay, setPickedDay }), [pickedDay, setPickedDay]);

  /* ------------------------------ Filters ------------------------------ */
  const secretSession = useSecretSession();
  const customCategory = category != null && category.default === false ? category : null;
  const categoryFilter = useMemo(() => {
    // Built-in menus (#102): 오늘 = due today or overdue, 다음 7일 = due within 7 days.
    if (isMenuType(selectedTodoMenuType)) return (task) => inMenu(selectedTodoMenuType, task);
    return (task) => !(customCategory && task.categories[customCategory.id] == null);
  }, [customCategory, selectedTodoMenuType]);

  // A task is secret when any of its categories is secret. Secret tasks show everywhere while the
  // top-bar lock is open (#104; showSecret and unlocked are the same flag), nowhere while locked.
  const { showSecret, unlocked: secretUnlocked } = secretSession;
  const locked = !!customCategory?.secret && !secretUnlocked;
  const secretFilterRef = useRef(null);
  const secretFilter = useMemo(() => {
    if (customCategory?.secret && !secretUnlocked) return () => false;
    if (showSecret || customCategory?.secret) return () => true;
    return (task) => !isSecretTask(task, categories);
  }, [customCategory, categories, showSecret, secretUnlocked]);
  secretFilterRef.current = secretFilter;

  const ordered = useMemo(() => storedOrder(taskMap), [taskMap]);
  const viewTasks = useMemo(
    () => ordered.filter((task) => categoryFilter(task) && secretFilter(task)),
    [ordered, categoryFilter, secretFilter]
  );

  const query = searchQuery.trim();
  const searching = query.length > 0;

  // Categories in sidebar order. Secret ones are named only while the lock is open.
  const categoryList = useMemo(() => sortCategories(Object.values(categories ?? {})), [categories]);
  const secretNamed = useCallback(
    (c) => !c.secret || showSecret || c.id === customCategory?.id,
    [showSecret, customCategory]
  );
  const catsOf = useCallback(
    (task) => categoryList.filter((c) => task.categories?.[c.id] && secretNamed(c)),
    [categoryList, secretNamed]
  );
  const categoryName = useCallback(
    (cid) => (categories?.[cid] && secretNamed(categories[cid]) ? categories[cid].title : null),
    [categories, secretNamed]
  );
  // What the pickers offer: secret categories only while unlocked.
  const pickable = useMemo(() => categoryList.filter((c) => !c.secret || secretUnlocked), [categoryList, secretUnlocked]);

  // Search looks through every task, whatever the menu (#102). While locked, secret tasks and the
  // names of secret categories stay out of the results too (#104), so nothing gives them away.
  const allCatsOf = useCallback((task) => categoryList.filter((c) => task.categories?.[c.id]), [categoryList]);
  const anyName = useCallback((cid) => {
    const c = categories?.[cid];
    return c && (!c.secret || showSecret) ? c.title : null;
  }, [categories, showSecret]);
  const isHiddenHit = useCallback((task) => !showSecret && isSecretTask(task, categories), [showSecret, categories]);
  const found = useMemo(() => {
    if (!searching) return null;
    const searchable = showSecret ? ordered : ordered.filter((task) => !isSecretTask(task, categories));
    return searchSections(searchable, query, anyName, { hideDone: prefs.hideDone });
  }, [searching, showSecret, ordered, categories, query, anyName, prefs.hideDone]);
  const foundTasks = useMemo(() => (found ? [...found.title, ...found.memo, ...found.category] : []), [found]);
  const shownTaskMap = useMemo(() => {
    const map = {};
    for (const task of searching ? foundTasks.filter((t) => !isHiddenHit(t)) : viewTasks) map[task.id] = task;
    return map;
  }, [searching, foundTasks, isHiddenHit, viewTasks]);
  // Tasks the selection may stay on: the screen's, or the results (hidden hits once unlocked).
  const visibleIds = useMemo(() => {
    const ids = new Set();
    if (searching) for (const t of foundTasks) { if (secretUnlocked || !isHiddenHit(t)) ids.add(t.id); }
    else for (const t of viewTasks) ids.add(t.id);
    return ids;
  }, [searching, foundTasks, secretUnlocked, isHiddenHit, viewTasks]);

  const getCategoryListSync = useCallback(() => {
    return new Promise((resolve, reject) => {
      IpcSender.req.category.getCategoryList(({ success, data }) => {
        if (success) {
          const newCategories = {};
          data.forEach((category) => {
            const c = Category.fromEntity(category);
            c.default = false;
            newCategories[category.cid] = c;
          });
          resolve({ categories: newCategories });
        } else {
          Toast.error("Failed to fetch data category list");
          console.error(`Failed to get category list`);
          reject();
        }
      });
    });
  }, []);

  const getTaskListSync = useCallback((transition) => {
    return new Promise((resolve, reject) => {
      IpcSender.req.task.getTaskList(({ success, data }) => {
        if (success) {
          // covert to Task objects
          const newTaskMap = {};
          for (let i = 0; i < data.length; i++) {
            const raw = data[i];
            const task = Task.fromEntity(raw);
            newTaskMap[task.id] = task;
          }

          // rearrange tasks and set next/prev nodes (linked list)
          for (let rawTask of data) {
            const nextTaskId = rawTask.next;
            const nextTask = nextTaskId != null ? newTaskMap[nextTaskId] : null;
            const curTask = newTaskMap[rawTask.tid];

            if (curTask) curTask.next = nextTask;
            if (nextTask) nextTask.prev = curTask;
          }
          resolve({ ...transition, taskMap: { ...taskMap, ...newTaskMap } });
        } else {
          console.error("failed to get task list");
          reject();
        }
      });
    });
    // Fetched once with the map as it was.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getSubTaskListSync = useCallback((transition) => {
    // fetch all subtasks
    return new Promise((resolve, reject) => {
      const { taskMap } = transition;
      IpcSender.req.task.getSubtaskList(({ success, data }) => {
        if (success) {
          for (let i = 0; i < data.length; i++) {
            const subtaskEntity = data[i];
            const subtask = Subtask.fromEntity(subtaskEntity);
            const taskId = subtaskEntity.tid;
            if (taskMap[taskId]) {
              taskMap[taskId].addSubtask(subtask);
            }
          }
          resolve({ ...transition, taskMap: { ...taskMap } });
        } else {
          console.error("failed to get subtask list");
          reject();
        }
      });
    });
  }, []);

  const getTasksCategoriesListSync = useCallback((transition) => {
    return new Promise((resolve, reject) => {
      const { taskMap, categories } = transition;
      IpcSender.req.tasks_categories.getTasksCategoriesList(
        ({ success, data }) => {
          if (success) {
            for (let i = 0; i < data.length; i++) {
              const taskCategoryEntity = data[i];
              const taskId = taskCategoryEntity.tid;
              const categoryId = taskCategoryEntity.cid;
              const category = categories[categoryId];
              if (taskMap[taskId]) {
                taskMap[taskId].addCategory(category);
              }
            }
            resolve({ ...transition, taskMap: { ...taskMap } });
          } else {
            console.error("failed to get task list");
            reject();
          }
        }
      );
    });
  }, []);

  const fetchAll = useCallback(async () => {
    let transition;
    transition = await getCategoryListSync();
    transition = await getTaskListSync(transition);
    transition = await getSubTaskListSync(transition);
    await getTasksCategoriesListSync(transition);
    addPromise(
      () =>
        new Promise((resolve) => {
          resolve(transition);
        })
    );
    await IpcSender.req.system.stateListenReady(true);
  }, [
    addPromise,
    getCategoryListSync,
    getSubTaskListSync,
    getTaskListSync,
    getTasksCategoriesListSync,
  ]);

  useEffect(() => {
    (async () => {
      await fetchAll();
    })();

    return () => {
      (async () => {
        await IpcSender.req.system.stateListenReady(false);
      })();
    };
  }, [fetchAll]);

  /* ------------------------------ Undo notice ------------------------------ */
  // The undo notice (#107.11) for adding, deleting and completing a task or a subtask, shown once
  // the change is sent. What an undo needs is taken from the lists as they are now (`current`).
  const undoNotice = useUndoNotice();
  const { show: showNotice, dismissDone, clear: clearNotice } = undoNotice;
  const current = useRef({});
  current.current = { taskMap, categories, ordered, selectedTaskId, synced: !!syncStatus };
  const secretOf = (task) => !!task && isSecretTask(task, current.current.categories);
  // A secret task's name never stays on screen once the lock closes; a vault lock, another
  // account and leaving the screen take any notice away.
  useEffect(() => {
    // Secret when shown, or made secret since; an undo the user already pressed still runs.
    if (!secretUnlocked) clearNotice((entry) => entry.secret || secretOf(current.current.taskMap[entry.target.tid]), { cancel: false });
    // secretOf reads `current`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secretUnlocked, clearNotice]);
  useEffect(() => IpcSender.vault?.onLocked?.(null, () => clearNotice()), [clearNotice]);
  const accountKey = syncStatus?.uid ?? null;
  useEffect(() => () => clearNotice(), [accountKey, clearNotice]);
  // A deleted task that was selected is selected again once its restore shows (it has a new id),
  // unless another task was selected meanwhile.
  const [reselect, setReselect] = useState(null);
  useEffect(() => {
    if (!reselect) return;
    if (selectedTaskId && selectedTaskId !== reselect) setReselect(null);
    else if (visibleIds.has(reselect)) {
      setSelectedTaskId(reselect);
      setReselect(null);
    }
  }, [reselect, selectedTaskId, visibleIds]);
  // Taking back a completion. A repeating task rolled forward: task/undoRecurringCompletion
  // deletes the done copy and puts the due and the subtasks back. Before the sync status comes
  // there is nothing to take back. Each returns send(callback) or null.
  const undoDone = (task) => {
    if (!task.repeatPeriod) return (callback = undoFailed) => IpcSender.req.task.updateTaskDone(task.id, false, Date.now(), callback);
    const due = dueMs(task.dueDate);
    if (!current.current.synced || due === null) return null;
    return (callback = undoFailed) => IpcSender.req.task.undoRecurringCompletion(task.id, due, callback);
  };
  // The restores are composites; they need the sync status first.
  const canRestore = () => current.current.synced;

  /* ------------------------------ Handlers ------------------------------ */
  // A task added with a secret category on a screen that hides secret tasks (locked) would
  // vanish without a word; it says where it went (secretFilterRef: the screen's filter).
  const onTaskAdd = useCallback((task) => {
    if (!(task instanceof Task)) return;
    const hidden = secretFilterRef.current ? !secretFilterRef.current(task) : false;
    IpcSender.req.task.addTask(task.toEntity(), (reply = {}) => {
      if (reply.success === false) failed("할 일을 추가하지 못했어요.")(reply);
      else if (hidden) Toast.info("비밀 카테고리 할 일은 잠금을 풀면 보여요.");
    });
  }, []);

  // A category made from a picker (quick add, the task menu): the next palette colour comes from
  // the picker. Resolves to its id once stored.
  const onCreateCategory = useCallback((title, color) => new Promise((resolve, reject) => {
    const created = new Category(title, false);
    created.id = v4();
    created.color = color;
    IpcSender.req.category.createCategory(created.toEntity(), (reply = {}) => {
      if (reply.success === false) {
        failed("카테고리를 만들지 못했어요.")(reply);
        reject(new Error("CATEGORY_CREATE_FAILED"));
      } else resolve(reply.data?.cid ?? created.id);
    });
  }), []);

  // Every task change the list and the detail panel (phase F) send.
  // Every change says so when it is refused (failed); setDue / setDone / setRepeat take an own
  // callback({ success }) instead when the caller needs the answer. Deleting and completing (a
  // task or a subtask) show the undo notice, adding does not (the user's call); unchecking lets a
  // notice about that completion go.
  const actions = useMemo(() => ({
    addTask: onTaskAdd,
    deleteTask: (tid) => {
      const { taskMap: map, ordered: list, selectedTaskId: selected } = current.current;
      const task = map[tid];
      if (!task) return IpcSender.req.task.deleteTask(tid, failed("할 일을 삭제하지 못했어요."));
      const snapshot = restoreSnapshot(task, list);
      const settle = showNotice({
        kind: "del", name: task.title, target: { tid }, secret: secretOf(task),
        undo: canRestore() ? () => IpcSender.req.task.restoreTask(snapshot, (reply = {}) => {
          if (reply.success === false) undoFailed(reply);
          else if (selected === tid) setReselect(snapshot.tid);
        }) : null,
      });
      IpcSender.req.task.deleteTask(tid, settled(settle, "할 일을 삭제하지 못했어요."));
    },
    setTitle: (tid, title) => IpcSender.req.task.updateTaskTitle(tid, title, failed("제목을 바꾸지 못했어요.")),
    // null clears the due; on a repeating task the model clears the repeat with it.
    // callback({ success }) answers it (the panel sends a repeat only after the due it needs).
    setDue: (tid, dueDate, callback) => IpcSender.req.task.updateTaskDueDate(tid, dueDate == null ? null : moment(dueDate).valueOf(), callback ?? failed("기한을 바꾸지 못했어요.")),
    setMemo: (tid, memo) => IpcSender.req.task.updateTaskMemo(tid, memo, failed("메모를 저장하지 못했어요.")),
    // callback({ success }) answers the change (the list restores a refused completion).
    setDone: (tid, done, callback) => {
      if (!done) dismissDone(tid);
      IpcSender.req.task.updateTaskDone(tid, done, Date.now(), callback ?? failed(done ? "완료하지 못했어요." : "완료를 취소하지 못했어요."));
    },
    addCategory: (tid, cid) => IpcSender.req.task.addTaskCategory(tid, cid, failed("카테고리를 넣지 못했어요.")),
    removeCategory: (tid, cid) => IpcSender.req.task.deleteTaskCategory(tid, cid, failed("카테고리를 빼지 못했어요.")),
    setRepeat: (tid, repeat, callback) => IpcSender.req.task.updateTaskRepeatPeriod(tid, repeat, callback ?? failed("반복을 정하지 못했어요.")),
    setImportant: (tid, important) => IpcSender.req.task.updateTaskImportant(tid, important, failed("중요 표시를 바꾸지 못했어요.")),
    duplicate: (tid) => IpcSender.req.task.duplicateTask(tid, null, failed("복제하지 못했어요.")),
    createCategory: onCreateCategory,
    addSubtask: (tid, subtask) => {
      if (subtask instanceof Subtask) IpcSender.req.task.createSubtask(subtask.toEntity(), tid, failed("하위 할 일을 추가하지 못했어요."));
    },
    deleteSubtask: (tid, sid) => {
      const task = current.current.taskMap[tid], subtask = task?.subtasks?.[sid];
      if (!subtask) return IpcSender.req.task.deleteSubtask(tid, sid, failed("하위 할 일을 삭제하지 못했어요."));
      // Back next to the subtask it followed (or before the one after it) in the shown order.
      const shown = sortSubtasks(Object.values(task.subtasks)), i = shown.indexOf(subtask);
      const near = { prevId: shown[i - 1]?.id ?? null, nextId: shown[i + 1]?.id ?? null };
      const entity = subtask.toEntity();
      const settle = showNotice({
        kind: "del", name: subtask.title, target: { tid, sid }, secret: secretOf(task),
        undo: canRestore() ? () => IpcSender.req.task.restoreSubtask(tid, entity, near, undoFailed) : null,
      });
      IpcSender.req.task.deleteSubtask(tid, sid, settled(settle, "하위 할 일을 삭제하지 못했어요."));
    },
    setSubtaskTitle: (tid, sid, title) => IpcSender.req.task.updateSubtaskTitle(tid, sid, title, failed("하위 할 일 이름을 바꾸지 못했어요.")),
    setSubtaskDue: (tid, sid, dueDate) => IpcSender.req.task.updateSubtaskDueDate(tid, sid, dueDate == null ? null : moment(dueDate).valueOf(), failed("하위 할 일 기한을 바꾸지 못했어요.")),
    setSubtaskDone: (tid, sid, done) => {
      const message = done ? "하위 할 일을 완료하지 못했어요." : "하위 할 일 완료를 취소하지 못했어요.";
      const task = current.current.taskMap[tid], subtask = task?.subtasks?.[sid];
      if (!done) dismissDone(tid, sid);
      if (!done || !subtask) return IpcSender.req.task.updateSubtaskDone(tid, sid, done, Date.now(), failed(message));
      const settle = showNotice({
        kind: "done", name: subtask.title, target: { tid, sid }, secret: secretOf(task),
        undo: () => IpcSender.req.task.updateSubtaskDone(tid, sid, false, Date.now(), undoFailed),
      });
      IpcSender.req.task.updateSubtaskDone(tid, sid, true, Date.now(), settled(settle, message));
    },
    // Puts the subtask next to anchorId (after it when `after`); callback({ success, data })
    // answers it (the panel shows the dropped order until the synced one has it). E2EE only.
    moveSubtask: (tid, sid, anchorId, after, callback) => IpcSender.req.task.updateSubtaskOrder(tid, sid, anchorId, after, callback),
    // secretOf and canRestore read `current`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [onTaskAdd, onCreateCategory, showNotice, dismissDone]);

  const toggleCategory = (task, cid) => {
    if (task.categories?.[cid]) actions.removeCategory(task.id, cid);
    else actions.addCategory(task.id, cid);
  };

  /* ------------------------------ Selection ------------------------------ */
  // Showing a task's detail: below 1000px the panel drawer opens; the calendar view's panel has
  // only 선택한 날, so the detail opens beside the list (mock).
  const shell = useRef({});
  shell.current = { view, layout };
  const revealDetail = useCallback(() => {
    const { view: current, layout: l } = shell.current;
    if (current === "calendar") setView("list");
    if (l.overlayPanel) l.setPanelOpen(true);
  }, []);
  // Counted so the panel shows the detail again for the task already selected (useTaskSelection).
  const [detailRequest, setDetailRequest] = useState(0);
  const openTask = useCallback((tid) => {
    setSelectedTaskId(tid);
    setDetailRequest((n) => n + 1);
    revealDetail();
  }, [revealDetail]);
  // A due reminder click (#91, main "reminder/open") opens its task; a task the current menu
  // does not show is looked up under 모든 할 일.
  const [reminderTask, setReminderTask] = useState(null);
  useEffect(() => {
    if (!IpcSender.onAll) return undefined;
    const listener = IpcSender.onAll("reminder/open", ({ success, data } = {}) => {
      if (success && typeof data?.tid === "string") setReminderTask(data.tid);
    });
    return () => IpcSender.off("reminder/open", listener);
  }, []);
  useEffect(() => {
    if (!reminderTask) return;
    if (visibleIds.has(reminderTask)) {
      setReminderTask(null);
      openTask(reminderTask);
    } else if (!taskMap[reminderTask]) setReminderTask(null);
    else if (selectedTodoMenuType !== TODO_MENU_TYPE.ALL) props.setSelectedTodoMenuType?.(TODO_MENU_TYPE.ALL);
    else setReminderTask(null);
  }, [reminderTask, visibleIds, taskMap, selectedTodoMenuType, openTask, props]);
  // The clock format for the notification text.
  useEffect(() => {
    try { IpcSender.reminders?.setTimeFormat(prefs.timeFormat); } catch {}
  }, [prefs.timeFormat]);
  const selectedVisible = !!selectedTaskId && visibleIds.has(selectedTaskId);
  const selectedTask = selectedVisible ? taskMap[selectedTaskId] ?? null : null;
  // A task that leaves the screen (deleted, another menu, hidden by the lock, not
  // in the results) leaves the selection, so nothing shows or acts on it.
  useEffect(() => {
    if (selectedTaskId && !selectedVisible) setSelectedTaskId(null);
  }, [selectedTaskId, selectedVisible]);
  // The task menu and its 새 카테고리 picker close the same way.
  useEffect(() => {
    if (menu && !visibleIds.has(menu.taskId)) setMenu(null);
    if (newCategoryFor && !visibleIds.has(newCategoryFor.taskId)) setNewCategoryFor(null);
  }, [menu, newCategoryFor, visibleIds]);

  // Deleting asks nothing since #107 (the undo notice takes it back). From a list row, focus goes
  // to the next row (else the one before), after the menu has given it back to the row.
  const [focusAfter, setFocusAfter] = useState(null);
  useEffect(() => {
    if (!focusAfter) return;
    if (focusAfter.isConnected) focusAfter.focus();
    setFocusAfter(null);
  }, [focusAfter]);
  const deleteNow = useCallback((task, row) => {
    const rows = row?.matches?.(".task-row") ? [...(row.closest(".tc-scroll")?.querySelectorAll(".task-row") ?? [])] : [];
    const i = rows.indexOf(row);
    const next = i < 0 ? null : rows[i + 1] ?? rows[i - 1] ?? null;
    actions.deleteTask(task.id);
    setSelectedTaskId((id) => (id === task.id ? null : id));
    if (next) setFocusAfter(next);
  }, [actions]);

  // The latest screen state for the handlers below, which stay the same so rows can skip renders.
  const live = useRef({});
  live.current = { categoryList, secretSession, visibleIds };

  // A hidden search hit: the unlock first (the dialog tinted with its secret category).
  const unlockFor = useCallback((task) => {
    const { categoryList: list, secretSession: session } = live.current;
    const secretCat = list.find((c) => c.secret && task.categories?.[c.id]);
    return session.unlock({ color: secretCat ? categoryColor(secretCat) : undefined });
  }, []);

  // A click elsewhere in the home screen (the sidebar, the list background, empty header space)
  // clears the selection. Rows, the panel, the quick add, popups, dialogs and the main area's
  // controls keep it, and so does the click that only dismisses a popup or the panel drawer.
  useEffect(() => {
    if (!selectedTaskId) return undefined;
    let dismissing = false;
    const onDown = () => { dismissing = openPopupCount() > 0; };
    const onClick = (event) => {
      const el = event.target instanceof Element ? event.target : null;
      if (event.button !== 0 || dismissing || !el?.isConnected || !el.closest(".home-layout")) return;
      if (el.closest("[data-task-id], .rp, .tc-quick, .tp-pop, .tp-dialog-wrap, .home-splitter, .home-scrim")) return;
      // In the main area its controls (view switch, view options, month arrows…) keep it too.
      if (el.closest(".todo-content") && el.closest("button, input, textarea, select, a, [role=button], [role=tab], [role=gridcell]")) return;
      setSelectedTaskId(null);
    };
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("click", onClick);
    return () => { document.removeEventListener("mousedown", onDown, true); document.removeEventListener("click", onClick); };
  }, [selectedTaskId, setSelectedTaskId]);

  // Esc clears the selection unless something above handled it (popups preventDefault their
  // Esc, a drawer closes first); Del deletes the selected (or focused) task when it is on screen
  // (a hidden search hit after the unlock).
  useEffect(() => {
    const onKey = (event) => {
      if (event.defaultPrevented || openPopupCount() > 0 || isEditable(event.target)) return;
      if (event.key === "Escape") {
        if (!selectedTaskId || (layout.hideSide && layout.sideOpen) || (layout.overlayPanel && layout.panelOpen)) return;
        setSelectedTaskId(null);
      } else if (event.key === "Delete") {
        // Held down it would delete row after row (focus moves to the next one) with only the
        // last one to undo.
        if (event.repeat) return;
        const active = document.activeElement;
        const inList = !active || active === document.body || !!active.closest?.(".todo-content");
        const rowEl = event.target instanceof Element ? event.target.closest(".todo-content [data-task-id]") : null;
        const task = taskMap[rowEl?.dataset.taskId ?? selectedTaskId];
        if (!inList || !task) return;
        const rowOf = () => rowEl || document.querySelector(`.todo-content [data-task-id="${task.id}"]`);
        if (searching && isHiddenHit(task) && !secretSession.unlocked && rowEl) {
          event.preventDefault();
          unlockFor(task).then((ok) => ok && deleteNow(task, rowOf()));
          return;
        }
        if (!visibleIds.has(task.id)) return;
        event.preventDefault();
        deleteNow(task, rowOf());
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selectedTaskId, taskMap, layout.hideSide, layout.sideOpen, layout.overlayPanel, layout.panelOpen, deleteNow,
    searching, isHiddenHit, secretSession.unlocked, visibleIds, unlockFor]);

  // A refused change shows the row again and says so; a completion that went through has the
  // undo notice (list, calendar, timeline and the panel all complete through here).
  const complete = useTaskCompletion((task, done, onFailed) => {
    const takeBack = done ? undoDone(task) : null;
    // Taking it back (#107 undo mock): the list row where the task is now (완료됨, or the next
    // occurrence) rises away first, and a repeating task flashes where it comes back. A row the
    // list has not moved yet (still hidden by the fall) just shows again in place.
    const undo = takeBack && (() => {
      const row = document.querySelector(`.todo-content .task-row[data-task-id="${CSS.escape(task.id)}"]`);
      const moved = !!row && row.style.visibility !== "hidden";
      onFailed?.();
      const send = () => {
        if (task.repeatPeriod) markRolled(task.id);
        takeBack((reply = {}) => {
          if (reply.success !== false) return;
          forgetRolled(task.id);
          if (row) restoreRow(row);
          undoFailed(reply);
        });
      };
      if (moved) riseAway(row, send);
      else send();
    });
    const settle = done
      ? showNotice({ kind: "done", name: task.title, target: { tid: task.id }, secret: secretOf(task), undo })
      : null;
    actions.setDone(task.id, done, ({ success } = {}) => {
      settle?.(success !== false);
      if (success !== false) return;
      Toast.error(done ? "완료하지 못했어요." : "완료를 취소하지 못했어요.");
      onFailed?.();
    });
  });

  // Completion from elsewhere (the panel) animates the task's list row when it is on screen.
  const completeTask = useCallback((task, done = true) => {
    const rowEl = document.querySelector(`.todo-content [data-task-id="${CSS.escape(task.id)}"]`);
    // A timeline row that stays once done does not fall (#107).
    complete(task, rowEl, done, !!rowEl?.classList.contains("tv-task") && !prefs.hideDone);
  }, [complete, prefs.hideDone]);
  const onSelect = useCallback((task) => openTask(task.id), [openTask]);
  const onToggleStar = useCallback((task) => actions.setImportant(task.id, !task.important), [actions]);
  const onMenu = useCallback((task, point, row) => {
    setSelectedTaskId(task.id);
    setMenu({ taskId: task.id, point, row });
  }, []);
  // For items outside the list (calendar, timeline, the panel's day list): the same task menu at
  // the pointer, and 열기. Only tasks on the screen. returnEl: where focus goes back after the
  // menu (the calendar's day cell; its items cannot take focus), else the item.
  const onTaskContextMenu = useCallback((event, taskId, returnEl) => {
    event?.preventDefault?.();
    if (!live.current.visibleIds.has(taskId)) return;
    setSelectedTaskId(taskId);
    setMenu({ taskId, point: { x: event?.clientX ?? 0, y: event?.clientY ?? 0 }, row: returnEl ?? event?.currentTarget ?? null });
  }, []);
  const onOpenTask = useCallback((taskId) => {
    if (live.current.visibleIds.has(taskId)) openTask(taskId);
  }, [openTask]);
  const onRowKeyDown = useCallback((event, task, row) => {
    if (event.target !== row) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") moveFocus(event, row.closest(".tc-scroll"), ".task-row");
  }, []);

  const rowHandlers = useMemo(() => ({
    catsOf: searching ? allCatsOf : catsOf,
    selectedId: selectedVisible ? selectedTaskId : null,
    isHidden: searching ? isHiddenHit : null,
    unlocked: secretUnlocked,
    onUnlock: unlockFor,
    onSelect,
    onToggleDone: complete,
    onToggleStar,
    onMenu,
    onKeyDown: onRowKeyDown,
  }), [searching, allCatsOf, catsOf, selectedVisible, selectedTaskId, isHiddenHit, secretUnlocked, unlockFor, onSelect, complete,
    onToggleStar, onMenu, onRowKeyDown]);

  /* ------------------------------ Header ------------------------------ */
  const isToday = selectedTodoMenuType === TODO_MENU_TYPE.TODAY;
  const title = searching ? "검색" : TODO_MENU_LABEL[selectedTodoMenuType] ?? customCategory?.title ?? "모든 할 일";
  const openCount = useMemo(() => viewTasks.filter((t) => !t.done).length, [viewTasks]);
  const overCount = useClock((now) => {
    let n = 0;
    for (const task of viewTasks) if (isOverdue(task, now)) n++;
    return n;
  });
  const summary = searching ? "할 일 제목 · 메모 · 카테고리에서 찾았어요"
    : locked ? "비밀 카테고리"
    : openCount === 0 ? "남은 할 일이 없어요"
    : overCount > 0 ? <>남은 할 일 {openCount}개 · <b>기한 지남 {overCount}개</b></>
    : `남은 할 일 ${openCount}개`;
  const onPref = useCallback((patch) => dispatch(setPrefs(patch)), [dispatch]);
  const onFold = useCallback((id, closed) => dispatch(setPrefs({ groupClosed: { [id]: closed } })), [dispatch]);

  // The locked screen names the way the vault opens.
  const { method: unlockMethod, probeMethod } = secretSession;
  useEffect(() => {
    if (locked) probeMethod?.();
  }, [locked, probeMethod]);
  const lockedState = locked ? {
    color: categoryColor(customCategory),
    label: unlockMethod === "os" ? `${osAuthName()}로 열기` : unlockMethod === "password" ? "보관함 비밀번호로 열기" : "잠금 풀기",
    onUnlock: () => secretSession.unlock({ color: categoryColor(customCategory) }),
  } : null;

  // The star shows once the sync status has come.
  const canStar = !!syncStatus;
  // The 오늘 / 다음 7일 date default is today's end, so a new day refreshes the defaults (the
  // quick add keeps chips the user changed; only a new screen starts them over).
  const quickDefaults = useMemo(
    () => quickAddDefaults({ menuType: selectedTodoMenuType, category: customCategory, secretUnlocked, now: today, canStar }),
    [selectedTodoMenuType, customCategory, secretUnlocked, today, canStar]
  );
  const quickKey = `${selectedTodoMenuType}|${customCategory?.id ?? ""}|${secretUnlocked}|${canStar}`;
  // One quick add for every view (#107): what was typed and chosen stays when the view changes.
  const [quickState, setQuickState] = useState(null);
  // The calendar and timeline's quick add, preselected to their picked day (null: none, e.g. in
  // search or on a locked category). The day is not part of the key: another day moves only an
  // untouched date chip and keeps the chips the user chose.
  const renderQuickAdd = useCallback((day) => (searching || locked ? null : (
    <QuickAdd
      defaults={quickAddDefaults({ menuType: selectedTodoMenuType, category: customCategory, secretUnlocked, day, now: today, canStar })}
      contextKey={quickKey}
      categories={pickable}
      onAdd={onTaskAdd}
      onCreateCategory={onCreateCategory}
      timeFormat={prefs.timeFormat}
      canStar={canStar}
      store={[quickState, setQuickState]}
    />
  )), [searching, locked, selectedTodoMenuType, customCategory, secretUnlocked, today, canStar, quickKey, pickable, onTaskAdd,
    onCreateCategory, prefs.timeFormat, quickState]);
  // Below 1000px the panel is a drawer; this header button opens it.
  const headerExtra = layout.overlayPanel ? <PanelOpenButton onOpen={() => layout.setPanelOpen(true)} /> : null;
  // The calendar and timeline draw their own header (title, month nav) with these.
  const header = { view, onView: setView, prefs, onPref, extra: headerExtra };
  // In search they show the results, and their summary says so.
  const searchNote = searching ? `검색 결과 ${Object.keys(shownTaskMap).length}개` : null;
  const otherViewProps = { header, catsOf: rowHandlers.catsOf, renderQuickAdd, onTaskContextMenu, onOpenTask, onToggleDone: complete, searchNote };

  const selection = useMemo(
    () => ({ selectedTaskId: selectedVisible ? selectedTaskId : null, setSelectedTaskId, openTask, detailRequest, selectedTask, actions, complete: completeTask, categories: categoryList, pickable }),
    [selectedVisible, selectedTaskId, openTask, detailRequest, selectedTask, actions, completeTask, categoryList, pickable]
  );

  // Not drawn for a task off the screen even before the effect above closes them.
  const onScreen = (id) => (visibleIds.has(id) ? taskMap[id] : null);
  const menuTask = menu ? onScreen(menu.taskId) : null;
  const newCategoryTask = newCategoryFor ? onScreen(newCategoryFor.taskId) : null;

  return (
    <ScreenContexts selection={selection} pickedDay={pickedDayValue}>
      <div className={"todo-content no-auto-hover" + (view === "list" ? " is-list" : "") + (layout.hideSide ? " has-menu" : "")}>
        {/* A locked secret category shows the list's locked state in every view. */}
        {view === "list" || (locked && !searching) ? (
          <>
            <ListHeader
              title={title}
              summary={summary}
              view={view}
              onView={setView}
              prefs={prefs}
              onPref={onPref}
              extra={headerExtra}
            />
            <div className="tc-gap" />
            <TaskListView
              key={selectedTodoMenuType}
              tasks={searching ? ordered : viewTasks}
              prefs={prefs}
              onFold={onFold}
              row={rowHandlers}
              query={query}
              search={searching}
              results={found}
              categoryName={searching ? anyName : categoryName}
              locked={searching ? null : lockedState}
              emptyTitle={isToday ? "오늘 할 일을 모두 끝냈어요" : "할 일이 없어요"}
            />
            {!searching && !locked && (
              <QuickAdd
                defaults={quickDefaults}
                contextKey={quickKey}
                categories={pickable}
                onAdd={onTaskAdd}
                onCreateCategory={onCreateCategory}
                timeFormat={prefs.timeFormat}
                canStar={canStar}
                store={[quickState, setQuickState]}
              />
            )}
          </>
        ) : (
          view === "calendar" ? (
            <TaskCalendarView filteredTaskMap={shownTaskMap} categories={categories} {...otherViewProps} />
          ) : (
            <TaskTimelineView filteredTaskMap={shownTaskMap} categories={categories} {...otherViewProps} />
          )
        )}
      </div>
      <PanelHost>
        <RightPanel
          view={view}
          tasks={shownTaskMap}
          catsOf={rowHandlers.catsOf}
          prefs={prefs}
          canStar={canStar}
          onTaskContextMenu={onTaskContextMenu}
        />
      </PanelHost>
      {children}
      {menuTask && (
        <TaskContextMenu
          key={menu.taskId}
          point={menu.point}
          due={menuTask.dueDate}
          important={!!menuTask.important}
          categoryIds={Object.keys(menuTask.categories ?? {})}
          categories={pickable}
          timeFormat={prefs.timeFormat}
          weekStart={prefs.weekStart}
          onOpen={() => openTask(menuTask.id)}
          onSetDue={(ms) => actions.setDue(menuTask.id, ms)}
          onToggleImportant={() => actions.setImportant(menuTask.id, !menuTask.important)}
          onToggleCategory={(cid) => toggleCategory(menuTask, cid)}
          onNewCategory={() => setNewCategoryFor({ taskId: menuTask.id, point: menu.point })}
          onDuplicate={() => actions.duplicate(menuTask.id)}
          onDelete={() => deleteNow(menuTask, menu.row)}
          onClose={() => setMenu(null)}
        />
      )}
      {newCategoryTask && (
        <CategoryPicker
          anchor={newCategoryFor.point}
          placement="point"
          initialCreate
          categories={pickable}
          selectedIds={Object.keys(newCategoryTask.categories ?? {})}
          onToggle={(cid) => toggleCategory(newCategoryTask, cid)}
          onCreate={onCreateCategory}
          onClose={() => setNewCategoryFor(null)}
        />
      )}
      <UndoNotice notice={undoNotice.notice} onUndo={undoNotice.undo} />
    </ScreenContexts>
  );
};

export default TodoContent;
