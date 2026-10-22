import { useEffect, useRef, useState } from "react";
import { CheckIcon, PencilIcon, Popover, TrashIcon } from "../../molecules/pickers";
import ColorSwatches from "./ColorSwatches";
import "./SidebarPopups.scss";

export const CATEGORY_TITLE_MAX = 40;

// A sidebar popup (mock .menu-pop beside the row): a Popover with its top-left corner at
// `anchor` ({ top, left } in window coordinates), kept inside the window and scrolled inside
// when too tall. It shares the popup stack with the menus and pickers: Esc closes the top popup
// only, an outside press closes it (`ignore`: elements that toggle it themselves), and focus
// goes back to `returnFocus` (the row or the ＋) when it closes.
export function SidebarPopup({ anchor, className = "", label, onClose, ignore, returnFocus, initialFocus, children }) {
  return (
    <Popover
      anchor={{ x: anchor.left, y: anchor.top }}
      placement="point"
      className={"side-pop " + className}
      label={label}
      ignoreOutside={ignore}
      returnFocus={returnFocus}
      initialFocus={initialFocus}
      onClose={() => onClose()}
    >
      {children}
    </Popover>
  );
}

// Right-click menu of a category row (mock categoryMenu): rename, colour, delete.
export function CategoryMenu({ category, color, anchor, returnFocus, onClose, onRename, onColor, onDelete }) {
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(category.title ?? "");
  const inputRef = useRef(null);

  useEffect(() => {
    if (!renaming) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [renaming]);

  const save = () => {
    const next = title.trim();
    if (next && next !== category.title) onRename(next);
    onClose();
  };

  return (
    <SidebarPopup anchor={anchor} className="cat-menu" label={`${category.title} 카테고리 메뉴`} returnFocus={returnFocus} onClose={onClose}>
      <div className="hd">
        {category.title}
        {category.secret ? " · 비밀" : ""}
      </div>
      {renaming ? (
        <label className="nc-in rename">
          <span className="dot" style={{ background: color }} />
          <input
            ref={inputRef}
            aria-label="카테고리 이름"
            data-own-escape=""
            value={title}
            maxLength={CATEGORY_TITLE_MAX}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
              if (e.key === "Enter") {
                e.preventDefault();
                save();
              } else if (e.key === "Escape") {
                // Esc leaves the field and keeps the menu.
                e.preventDefault();
                e.stopPropagation();
                setTitle(category.title ?? "");
                setRenaming(false);
              }
            }}
          />
        </label>
      ) : (
        <button type="button" className="mi" onClick={() => setRenaming(true)}>
          <span className="mic">
            <PencilIcon />
          </span>
          <span>이름 바꾸기</span>
        </button>
      )}
      <div className="hd">색</div>
      <ColorSwatches value={color} onChange={onColor} />
      <div className="sp" />
      <button type="button" className="mi danger" onClick={onDelete}>
        <span className="mic">
          <TrashIcon />
        </span>
        <span>카테고리 삭제</span>
      </button>
    </SidebarPopup>
  );
}

// "카테고리 ＋" popup (mock newCategory): name, colour, secret checkbox. `opener` is the ＋,
// which toggles it.
export function NewCategoryPopup({ anchor, defaultColor, secretLine, onClose, onCreate, opener }) {
  const [title, setTitle] = useState("");
  const [color, setColor] = useState(defaultColor);
  const [secret, setSecret] = useState(false);
  const inputRef = useRef(null);
  const name = title.trim();

  const create = () => {
    if (!name) return;
    onCreate({ title: name, color, secret });
    onClose();
  };

  return (
    <SidebarPopup
      anchor={anchor}
      className="new-cat"
      label="새 카테고리"
      ignore={[opener]}
      returnFocus={opener}
      initialFocus={inputRef}
      onClose={onClose}
    >
      <label className="nc-in">
        <span className="dot" style={{ background: color }} />
        <input
          ref={inputRef}
          aria-label="새 카테고리 이름"
          placeholder="새 카테고리 이름"
          value={title}
          maxLength={CATEGORY_TITLE_MAX}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing || e.keyCode === 229) return;
            if (e.key === "Enter") {
              e.preventDefault();
              create();
            }
          }}
        />
      </label>
      <div className="hd">색</div>
      <ColorSwatches value={color} onChange={(next) => setColor(next)} />
      <button
        type="button"
        className="nc-row"
        role="checkbox"
        aria-checked={secret}
        onClick={() => setSecret((v) => !v)}
      >
        <span className={"cbx" + (secret ? " on" : "")}>{secret && <CheckIcon width="10" height="10" />}</span>
        <span className="nc-tx">
          <span>비밀 카테고리</span>
          <small>{secretLine}</small>
        </span>
      </button>
      <div className="pop-foot">
        <span className="sum" />
        <button type="button" className="pop-btn" onClick={onClose}>
          취소
        </button>
        <button type="button" className="pop-btn pri" disabled={!name} onClick={create}>
          만들기
        </button>
      </div>
    </SidebarPopup>
  );
}
