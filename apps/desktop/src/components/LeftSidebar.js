import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { useOutletContext } from "react-router-dom";
import Toast from "molecules/Toast";
import Category from "objects/Category";
import { accountInfoSlice } from "store/accountSlice";
import { categoryMoveAnchor, sortCategories } from "utils/categoryOrder";
import { categoryColor, nextPaletteColor } from "utils/categoryColors";
import IpcSender from "utils/IpcSender";
import {
  TODO_MENU_LABEL,
  TODO_MENU_ORDER,
  TODO_MENU_TYPE,
  categoryTaskCount,
  sidebarCounts,
} from "utils/menuFilters";
import "./LeftSidebar.scss";
import useClock from "../hooks/UseClock";
import { secretMethodLine, useSecretSession } from "../hooks/useSecretSession";
import Clock from "./Clock";
import { openModal } from "../molecules/Modal";
import {
  AllIcon,
  ConfirmDialog,
  GearIcon,
  PlusIcon,
  ShieldIcon,
  StarIcon,
  SunIcon,
  WeekIcon,
  categoryDeleteConfirm,
  closeAllPopups,
} from "../molecules/pickers";
import { MODAL_TYPES } from "../routers/ModalRouter";
import { CategoryMenu, NewCategoryPopup } from "./sidebar/CategoryPopups";
import useCategoryDrag from "./sidebar/useCategoryDrag";

// The menu ids live in utils/menuFilters; kept here for the existing imports.
export { TODO_MENU_TYPE };

const MENU_ICON = {
  [TODO_MENU_TYPE.ALL]: <AllIcon />,
  [TODO_MENU_TYPE.TODAY]: <SunIcon />,
  [TODO_MENU_TYPE.NEXT_7_DAYS]: <WeekIcon />,
  [TODO_MENU_TYPE.IMPORTANT]: <StarIcon />,
};

const activateWithKeyboard = (event) => {
  if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault();
    event.currentTarget.click();
  }
};

// The account band's second line, from the sync-v2 status (E2EE and plaintext v2) or, on
// the legacy path, from the block nonces.
export function syncLine(status, { offlineMode = false, localNonce, remoteNonce } = {}) {
  if (status) {
    if (status.error) return { state: "error", text: "동기화 오류" };
    if (!status.ready || status.connected === false) return { state: "offline", text: "오프라인" };
    if (status.syncing || status.pending > 0) return { state: "syncing", text: "동기화 중…" };
    return { state: "synced", text: "모두 동기화됨" };
  }
  if (offlineMode) return { state: "offline", text: "오프라인" };
  if (remoteNonce == null || localNonce !== remoteNonce) return { state: "syncing", text: "동기화 중…" };
  return { state: "synced", text: "모두 동기화됨" };
}

// The category order (sort_rank) is E2EE-only: the E2EE status says protocolVersion 3, and
// the legacy and plaintext v2 paths answer the move with UNSUPPORTED_*. Seen once, the
// sidebar stops offering the drag for the rest of the run (all sidebar instances).
let orderRefused = false;
export const orderSupported = (syncStatus) => !orderRefused && syncStatus?.protocolVersion === 3;
export const resetOrderSupportForTests = () => {
  orderRefused = false;
};
const isUnsupported = (data) => /^UNSUPPORTED_/.test(data?.code ?? "");

// Whether the synced order has the move: the category right after (or before) its anchor.
const hasMove = (ids, { id, anchorId, after }) => {
  const i = ids.indexOf(id), j = ids.indexOf(anchorId);
  return i >= 0 && j >= 0 && i === j + (after ? 1 : -1);
};

// mode: "full" (232px), "rail" (icons, 56px) or "drawer" (full sidebar in the ☰ drawer).
const LeftSidebar = ({ setSelectedTodoMenuType, selectedTodoMenuType, mode = "full" }) => {
  const context = useOutletContext();
  const { localNonce, remoteNonce, states, syncStatus, searchQuery = "" } = context;
  // While searching, the results cover every menu, so no menu row shows as the current one.
  const searching = String(searchQuery).trim().length > 0;
  const { categories, taskMap } = states;
  const rail = mode === "rail";
  const rootRef = useRef(null);
  const addRef = useRef(null);
  const secret = useSecretSession();
  const [, setRefused] = useState(orderRefused);
  const canSort = orderSupported(syncStatus);

  const accountInfo = useSelector(accountInfoSlice);
  const offlineMode = accountInfo?.offlineMode ?? false;
  // An account without a name shows its email as the name (#103); the line below is the email.
  const email = accountInfo?.googleEmail || "";
  const username = accountInfo?.username || email || accountInfo?.uid || "내 계정";
  const accountLine = email && email !== username ? email : "나의 작업 공간";
  const profileImageUrl =
    (offlineMode ? accountInfo?.profileImageUrl : accountInfo?.googleProfileImageUrl) ?? null;
  const sync = syncLine(syncStatus, { offlineMode, localNonce, remoteNonce });

  /* ----------------------------- Order (drag) ----------------------------- */
  const syncedOrder = useMemo(() => sortCategories(Object.values(categories)), [categories]);
  // The dropped order, shown until the synced order has the move. Each drop has a number, so
  // the reply of an older drop does not end a newer one.
  const [pending, setPending] = useState(null); // { seq, ids, move, acked }
  const dropSeq = useRef(0);
  const sortedCategories = useMemo(() => {
    if (!pending) return syncedOrder;
    const byId = Object.fromEntries(syncedOrder.map((c) => [c.id, c]));
    const kept = pending.ids.map((id) => byId[id]).filter(Boolean);
    return [...kept, ...syncedOrder.filter((c) => !pending.ids.includes(c.id))];
  }, [pending, syncedOrder]);
  const syncedIds = useMemo(() => syncedOrder.map((c) => c.id), [syncedOrder]);
  const lastSynced = useRef(syncedIds);
  useEffect(() => {
    const changed = lastSynced.current !== syncedIds;
    lastSynced.current = syncedIds;
    // The synced order has the move, or the state after the reply came (the truth now).
    if (pending && (hasMove(syncedIds, pending.move) || (changed && pending.acked))) setPending(null);
  }, [syncedIds, pending]);

  /* --------------------------- Colour overrides --------------------------- */
  // The colour picked in the menu, shown until the synced colour arrives: { color, sent, seq,
  // acked }. A preview (sent false) lasts while the menu is open.
  const [colorDraft, setColorDraft] = useState({});
  const colorSeq = useRef(0);
  const lastCategories = useRef(categories);
  useEffect(() => {
    const changed = lastCategories.current !== categories;
    lastCategories.current = categories;
    setColorDraft((prev) => {
      const next = { ...prev };
      let removed = false;
      for (const cid in prev) {
        const draft = prev[cid];
        const done = draft.sent && (categoryColor(categories[cid]) === draft.color || (changed && draft.acked));
        if (!categories[cid] || done) {
          delete next[cid];
          removed = true;
        }
      }
      return removed ? next : prev;
    });
  }, [categories]);
  const colorOf = (category) => colorDraft[category.id]?.color ?? categoryColor(category);
  const dropPreview = useCallback(
    (cid) =>
      setColorDraft((prev) => {
        if (!prev[cid] || prev[cid].sent) return prev;
        const next = { ...prev };
        delete next[cid];
        return next;
      }),
    []
  );

  /* -------------------------------- Counts -------------------------------- */
  // Recounted every minute so 오늘 / 다음 7일 / overdue follow the clock.
  const minute = useClock((now) => Math.floor(now / 60000));
  const { counts, overdue } = useMemo(
    () => sidebarCounts(taskMap, categories, { showSecret: secret.showSecret, now: Date.now() }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [taskMap, categories, secret.showSecret, minute]
  );

  /* -------------------------------- Popups -------------------------------- */
  const [menu, setMenu] = useState(null); // { cid, anchor, row }
  const [creating, setCreating] = useState(null); // { anchor }
  const [confirm, setConfirm] = useState(null);
  const menuRef = useRef(null);
  menuRef.current = menu;
  // Closing the menu drops a colour still being previewed (a knob let go by Esc).
  const closeMenu = useCallback(() => {
    if (menuRef.current) dropPreview(menuRef.current.cid);
    setMenu(null);
  }, [dropPreview]);
  const closeCreating = useCallback(() => setCreating(null), []);

  const popupAnchor = (target) => {
    const side = rootRef.current?.getBoundingClientRect();
    const row = target.getBoundingClientRect();
    return { top: Math.round(row.top), left: Math.round((side?.left ?? 0) + (rail ? 60 : 226)) };
  };

  useCategoryDrag(rootRef, {
    enabled: canSort,
    // A lifted row closes every open popup, the task menus and pickers of the list too.
    onLift: () => {
      closeMenu();
      setCreating(null);
      closeAllPopups();
    },
    onDrop: (id, from, to) => {
      const ids = sortedCategories.map((c) => c.id);
      const move = categoryMoveAnchor(ids, id, to);
      if (!move) return;
      const next = ids.filter((x) => x !== id);
      next.splice(to, 0, id);
      const seq = ++dropSeq.current;
      setPending({ seq, ids: next, move: { id, ...move }, acked: false });
      IpcSender.req.category.updateCategoryOrder(id, move.anchorId, move.after, ({ success, data } = {}) => {
        setPending((p) => (p?.seq !== seq ? p : success ? { ...p, acked: true } : null));
        if (success) return;
        if (isUnsupported(data)) {
          orderRefused = true;
          setRefused(true);
          Toast.warn("이 계정에서는 카테고리 순서를 바꿀 수 없어요.");
        } else Toast.warn("카테고리 순서를 바꾸지 못했어요.");
      });
    },
  });

  /* ------------------------------- Actions -------------------------------- */
  const openCategory = async (category) => {
    if (category.secret && !secret.unlocked) {
      const ok = await secret.unlock({ color: colorOf(category) });
      if (!ok) return;
    }
    setSelectedTodoMenuType(category.id);
  };

  const createCategory = ({ title, color, secret: isSecret }) => {
    const category = new Category(title, isSecret);
    category.color = color;
    IpcSender.req.category.createCategory(category.toEntity(), ({ success } = {}) => {
      if (success === false) Toast.error("카테고리를 만들지 못했어요.");
    });
  };

  const renameCategory = (cid, title) => {
    IpcSender.req.category.updateCategoryTitle(cid, title, ({ success } = {}) => {
      if (success === false) Toast.error("이름을 바꾸지 못했어요.");
    });
  };

  const changeColor = (cid, color, final) => {
    if (!final) return setColorDraft((prev) => ({ ...prev, [cid]: { color, sent: false } }));
    const seq = ++colorSeq.current;
    setColorDraft((prev) => ({ ...prev, [cid]: { color, sent: true, seq, acked: false } }));
    IpcSender.req.category.updateCategoryColor(cid, color, ({ success } = {}) => {
      setColorDraft((prev) => {
        if (prev[cid]?.seq !== seq) return prev;
        const next = { ...prev };
        if (success === false) delete next[cid];
        else next[cid] = { ...prev[cid], acked: true };
        return next;
      });
      if (success === false) Toast.error("색을 바꾸지 못했어요.");
    });
  };

  const done = (label) => ({ success } = {}) => {
    if (success === false) Toast.error(`${label}하지 못했어요.`);
  };

  const askDelete = async (category, row) => {
    closeMenu();
    // A secret category is deleted only while unlocked.
    if (category.secret && !secret.unlocked) {
      const ok = await secret.unlock({ color: colorOf(category) });
      if (!ok) return;
    }
    const n = categoryTaskCount(taskMap, categories, category.id, { showSecret: secret.showSecret });
    setConfirm({
      category,
      row,
      props: categoryDeleteConfirm({ title: category.title, secret: category.secret, color: colorOf(category) }, n),
      // n counts only the tasks this screen may show; hidden secret tasks can still use the
      // category. On E2EE "take it off its tasks, then delete" covers them (and is a plain delete
      // when nothing uses it); the plaintext paths know only the plain delete.
      run: (choice) => {
        if (choice === "tasks") IpcSender.req.category.deleteCategoryWithTasks(category.id, done("카테고리를 삭제"));
        else if (n > 0 || syncStatus?.protocolVersion === 3) IpcSender.req.category.deleteCategoryInUse(category.id, done("카테고리를 삭제"));
        else IpcSender.req.category.deleteCategory(category.id, done("카테고리를 삭제"));
      },
    });
  };

  /* -------------------------------- Render -------------------------------- */
  const menuCategory = menu && categories[menu.cid];

  return (
    <aside
      ref={rootRef}
      className={`component left-sidebar no-auto-hover ${mode}${rail ? " rail" : ""}`}
      aria-label="메뉴"
    >
      <Clock compact={rail} />
      <div className="side-scroll">
        {TODO_MENU_ORDER.map((id) => {
          const label = TODO_MENU_LABEL[id];
          const red = id === TODO_MENU_TYPE.TODAY && overdue;
          const selected = !searching && selectedTodoMenuType === id;
          return (
            <div
              key={id}
              role="button"
              tabIndex={0}
              aria-current={selected ? "page" : undefined}
              aria-label={label}
              data-tip={label}
              data-menu={id}
              onKeyDown={activateWithKeyboard}
              className={"side-row" + (selected ? " on" : "")}
              onClick={() => setSelectedTodoMenuType(id)}
            >
              <span className="ic">{MENU_ICON[id]}</span>
              <span className="lbl">{label}</span>
              <span className={"n" + (red ? " due" : "")}>{counts[id] || ""}</span>
              {red && <i className="badge" />}
            </div>
          );
        })}
        <div className="grp">
          <span className="grp-t">카테고리</span>
          <span
            ref={addRef}
            className="grp-add"
            role="button"
            tabIndex={0}
            aria-label="카테고리 추가"
            aria-expanded={!!creating}
            data-tip="카테고리 추가"
            onKeyDown={activateWithKeyboard}
            onClick={(e) => {
              if (creating) return setCreating(null);
              closeMenu();
              secret.probeMethod?.();
              setCreating({ anchor: popupAnchor(e.currentTarget) });
            }}
          >
            <PlusIcon size={14} />
          </span>
        </div>
        {sortedCategories.map((category) => {
          const color = colorOf(category);
          const selected = !searching && selectedTodoMenuType === category.id;
          return (
            <div
              key={category.id}
              role="button"
              tabIndex={0}
              aria-current={selected ? "page" : undefined}
              aria-label={category.secret ? `${category.title} (비밀)` : category.title}
              data-tip={category.title}
              data-catrow={category.id}
              onKeyDown={activateWithKeyboard}
              className={
                "side-row cat-row" + (selected ? " on" : "") + (menu?.cid === category.id ? " menu-on" : "")
              }
              onClick={() => openCategory(category)}
              onContextMenu={(e) => {
                e.preventDefault();
                setCreating(null);
                if (menu) dropPreview(menu.cid);
                setMenu({ cid: category.id, anchor: popupAnchor(e.currentTarget), row: e.currentTarget });
              }}
            >
              <span className="ic" style={category.secret ? { color } : undefined}>
                {category.secret ? <ShieldIcon /> : <span className="dot" style={{ background: color }} />}
              </span>
              <span className="lbl">{category.title}</span>
              <span className="n">{category.secret ? "" : counts[category.id] || ""}</span>
            </div>
          );
        })}
      </div>
      <div className="foot">
        <span className="av-w" data-tip={sync.text}>
          <span className="av">
            {profileImageUrl ? <img src={profileImageUrl} alt="" /> : String(username).trim().charAt(0).toUpperCase()}
          </span>
          <i className={"sync-dot " + sync.state} role="img" aria-label={sync.text} />
        </span>
        <span className="who">
          <span className="name">{username}</span>
          <small>{accountLine}</small>
        </span>
        <button
          type="button"
          className="gear"
          aria-label="설정"
          data-tip={rail ? `설정 · ${sync.text}` : "설정"}
          onClick={() => openModal(MODAL_TYPES.SETTINGS)}
        >
          <GearIcon />
        </button>
      </div>
      {menuCategory && (
        <CategoryMenu
          key={menuCategory.id}
          category={menuCategory}
          color={colorOf(menuCategory)}
          anchor={menu.anchor}
          returnFocus={menu.row}
          onClose={closeMenu}
          onRename={(title) => renameCategory(menuCategory.id, title)}
          onColor={(color, final) => changeColor(menuCategory.id, color, final)}
          onDelete={() => askDelete(menuCategory, menu.row)}
        />
      )}
      {creating && (
        <NewCategoryPopup
          anchor={creating.anchor}
          defaultColor={nextPaletteColor(categories)}
          secretLine={secretMethodLine(secret.method)}
          opener={addRef}
          onClose={closeCreating}
          onCreate={createCategory}
        />
      )}
      {confirm && (
        <ConfirmDialog
          {...confirm.props}
          returnFocus={confirm.row}
          onChoose={(choice) => {
            setConfirm(null);
            confirm.run(choice);
          }}
          onCancel={() => setConfirm(null)}
        />
      )}
    </aside>
  );
};

export default LeftSidebar;
