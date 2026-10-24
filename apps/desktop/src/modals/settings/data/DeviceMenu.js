import { useEffect, useRef, useState } from "react";
import { IoEllipsisHorizontal, IoPencilOutline, IoUnlinkOutline } from "react-icons/io5";

// The ⋯ menu of a connected device row (#77, mock frame ③): 이름 바꾸기, and 기기 해제 for
// another device on the owner PC. Closes on a choice, a click outside or Esc.
export default function DeviceMenu({ label, onRename, onRemove }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    ref.current?.querySelector('[role="menuitem"]')?.focus();
    const onDown = (event) => { if (!ref.current?.contains(event.target)) setOpen(false); };
    const onKey = (event) => {
      if (event.key !== "Escape") return;
      // The settings window would close on the same key.
      event.stopPropagation();
      setOpen(false);
      ref.current?.querySelector(".device-menu__more")?.focus();
    };
    document.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);
  const pick = (action) => () => { setOpen(false); action(); };
  return (
    <div className="device-menu" ref={ref}>
      <button type="button" className={"device-menu__more" + (open ? " device-menu__more--on" : "")}
        aria-label={`${label} 더 보기`} title="더 보기" aria-haspopup="menu" aria-expanded={open}
        onClick={() => setOpen((value) => !value)}>
        <IoEllipsisHorizontal aria-hidden="true" />
      </button>
      {open && (
        <div className="device-menu__list" role="menu" aria-label={label}>
          <button type="button" role="menuitem" onClick={pick(onRename)}><IoPencilOutline aria-hidden="true" />이름 바꾸기</button>
          {onRemove && (
            <button type="button" role="menuitem" className="device-menu__danger" onClick={pick(onRemove)}>
              <IoUnlinkOutline aria-hidden="true" />기기 해제
            </button>
          )}
        </div>
      )}
    </div>
  );
}
