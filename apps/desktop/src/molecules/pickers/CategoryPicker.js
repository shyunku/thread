import { useEffect, useRef, useState } from "react";
import { categoryColor, nextPaletteColor } from "utils/categoryColors";
import { CheckIcon, CloseIcon, PlusIcon, SearchIcon, ShieldIcon } from "./icons";
import Popover from "./Popover";
import { moveFocus } from "./focusNav";

const nameOf = (c) => c.title ?? c.name ?? "";

// Puts the full name in the tooltip only while it is cut off.
function tipIfCut(event) {
  const el = event.currentTarget.querySelector(".pk-lb");
  if (!el) return;
  if (el.scrollWidth > el.clientWidth) el.setAttribute("data-tip", el.textContent);
  else el.removeAttribute("data-tip");
}

// 카테고리 (#102 mock categoryPicker). Several at once: rows toggle through onToggle(id) and the
// picker stays open. A search field filters the rows. "새 카테고리" turns into a name field +
// 만들기 in place: onCreate(name, color) gets the next unused palette colour and resolves to the
// new category's id, which is then ticked with onToggle. Esc in the name field cancels only that.
// categories: [{ id, title, color, secret }] in display order; selectedIds: ticked ids.
// initialCreate opens with the name field (the task menu's 새 카테고리…).
export default function CategoryPicker({
  categories = [], selectedIds = [], onToggle, onCreate, onClose, initialCreate = false,
  anchor, placement = "bottom-start", offset, gap, returnFocus, ignoreOutside,
}) {
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(!!initialCreate && !!onCreate);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [focusAdd, setFocusAdd] = useState(false);
  const listRef = useRef(null);
  const searchRef = useRef(null);
  const nameRef = useRef(null);
  const addRef = useRef(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const selected = new Set(selectedIds);
  const q = query.trim().toLowerCase();
  const shown = categories.filter((c) => !q || nameOf(c).toLowerCase().includes(q));
  const color = nextPaletteColor(categories);

  const startCreate = () => {
    // The search text is usually the name that was not found.
    setName(query.trim());
    setCreating(true);
  };
  // Leaving the name field puts focus back on 새 카테고리 (the field goes away).
  const endCreate = () => {
    setCreating(false);
    setName("");
    setFocusAdd(true);
  };
  const create = async () => {
    const title = name.trim();
    if (!title || busy || !onCreate) return;
    setBusy(true);
    try {
      const id = await onCreate(title, color);
      if (!alive.current) return;
      if (id != null && !selected.has(id)) onToggle?.(id);
      setQuery("");
      endCreate();
    } catch {
      // The caller reports the failure; the field stays for another try.
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  useEffect(() => { if (creating) nameRef.current?.focus(); }, [creating]);
  useEffect(() => {
    if (!focusAdd) return;
    setFocusAdd(false);
    addRef.current?.focus();
  }, [focusAdd]);

  const onListKey = (event) => {
    if (event.key === "ArrowUp" && listRef.current?.querySelector(".pk-row") === document.activeElement) {
      event.preventDefault();
      searchRef.current?.focus();
      return;
    }
    moveFocus(event, listRef.current, ".pk-row");
  };

  return (
    <Popover
      anchor={anchor}
      placement={placement}
      offset={offset}
      gap={gap}
      returnFocus={returnFocus}
      ignoreOutside={ignoreOutside}
      className="pk"
      label="카테고리"
      initialFocus={creating ? nameRef : searchRef}
      onClose={() => onClose?.()}
    >
      <div className="dp-h">
        <span>카테고리</span>
        <button type="button" className="dp-x" aria-label="닫기" data-tip="닫기" onClick={() => onClose?.()}><CloseIcon /></button>
      </div>
      <label className="pk-search">
        <SearchIcon />
        <input
          ref={searchRef}
          type="text"
          value={query}
          placeholder="카테고리 찾기"
          aria-label="카테고리 찾기"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); listRef.current?.querySelector(".pk-row")?.focus(); }
          }}
        />
      </label>
      <div className="pk-list" ref={listRef} role="group" aria-label="카테고리 목록" onKeyDown={onListKey}>
        {shown.map((c) => {
          const on = selected.has(c.id);
          const tint = categoryColor(c);
          return (
            <button key={c.id} type="button" role="checkbox" aria-checked={on} className={`pk-row${on ? " on" : ""}`} onMouseEnter={tipIfCut} onClick={() => onToggle?.(c.id)}>
              <span className={`pk-cbx${on ? " on" : ""}`}>{on && <CheckIcon />}</span>
              {c.secret
                ? <span className="pk-ci" style={{ color: tint }} role="img" aria-label="비밀 카테고리"><ShieldIcon size={14} /></span>
                : <span className="pk-ci"><span className="pk-dot" style={{ background: tint }} /></span>}
              <span className="pk-lb">{nameOf(c)}</span>
            </button>
          );
        })}
        {!shown.length && <p className="pk-empty">{categories.length ? "찾는 카테고리가 없어요." : "카테고리가 아직 없어요."}</p>}
      </div>
      {onCreate && <div className="pk-sp" />}
      {onCreate && (creating ? (
        <>
          <div className="pk-new">
            <span className="pk-dot" style={{ background: color }} aria-hidden="true" />
            <input
              ref={nameRef}
              className="pk-in"
              type="text"
              value={name}
              maxLength={100}
              placeholder="카테고리 이름"
              aria-label="새 카테고리 이름"
              data-own-escape=""
              disabled={busy}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                // Enter while composing Korean finishes the syllable, not the name.
                if (e.key === "Enter" && !(e.nativeEvent.isComposing || e.keyCode === 229)) { e.preventDefault(); create(); }
                else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); endCreate(); }
              }}
            />
            <button type="button" className="pk-make" disabled={!name.trim() || busy} onClick={create}>만들기</button>
          </div>
          <p className="dp-note">색은 차례대로 정해져요.<br />카테고리를 우클릭해서 바꿀 수 있어요.</p>
        </>
      ) : (
        <button ref={addRef} type="button" className="pk-add" onClick={startCreate}><PlusIcon />새 카테고리</button>
      ))}
    </Popover>
  );
}
