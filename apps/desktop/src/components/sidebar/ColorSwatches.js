import { useEffect, useRef, useState } from "react";
import {
  CATEGORY_PALETTE,
  hexToHsv,
  hsvToHex,
  inPalette,
  isLowContrast,
  normalizeHex,
} from "../../utils/categoryColors";

const clamp01 = (v) => Math.min(1, Math.max(0, v));

// Palette swatches plus the rainbow "직접 고르기" swatch that opens an HSV square, a hue
// bar and a hex field (#102 mock swatches()/customPicker()). onChange(color, final): final
// is false while a knob is dragged or an arrow key is held (preview only) and true when the
// colour is settled. A drag still running when the popup closes is dropped, not saved.
export default function ColorSwatches({ value, onChange }) {
  const current = normalizeHex(value) || CATEGORY_PALETTE[0];
  const custom = !inPalette(current);
  const [open, setOpen] = useState(false);
  const [hsv, setHsv] = useState(() => hexToHsv(current));
  const [hex, setHex] = useState(current.toUpperCase());
  const dragging = useRef(false);
  const latest = useRef(hsv); // the HSV last shown, for the key-up commit
  const endDrag = useRef(null); // removes the window listeners of a running drag
  const keyHeld = useRef(false);

  useEffect(() => () => endDrag.current?.(), []);

  // Follow outside changes (a palette pick, a synced colour) unless a knob is held.
  useEffect(() => {
    if (dragging.current) return;
    setHex(current.toUpperCase());
    const prev = latest.current;
    const next = hsvToHex(prev.h, prev.s, prev.v) === current ? prev : hexToHsv(current);
    latest.current = next;
    setHsv(next);
  }, [current]);

  const pickFromHsv = (next, final) => {
    latest.current = next;
    setHsv(next);
    const color = hsvToHex(next.h, next.s, next.v);
    setHex(color.toUpperCase());
    onChange(color, final);
  };

  // Drag in the square or the bar: preview on move, settle on release.
  const dragHandler = (read) => (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const el = event.currentTarget;
    const rect = el.getBoundingClientRect();
    let last = hsv;
    const at = (e) => {
      last = read(e, rect, last);
      return last;
    };
    endDrag.current?.();
    dragging.current = true;
    pickFromHsv(at(event), false);
    const move = (e) => pickFromHsv(at(e), false);
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      dragging.current = false;
      endDrag.current = null;
    };
    const up = (e) => {
      stop();
      pickFromHsv(e.type === "pointercancel" ? last : at(e), true);
    };
    endDrag.current = stop;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };
  const readSv = (e, r, prev) => ({
    ...prev,
    s: clamp01((e.clientX - r.left) / r.width),
    v: clamp01(1 - (e.clientY - r.top) / r.height),
  });
  const readHue = (e, r, prev) => ({ ...prev, h: Math.round(clamp01((e.clientX - r.left) / r.width) * 360) });

  // Arrow keys move a knob by 1 (Shift: 10): the square by % of saturation (←→) and brightness
  // (↑↓), the bar by degrees. Previewed while held, saved on key-up.
  const keyMove = (kind) => (event) => {
    const dir = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[event.key];
    if (!dir) return;
    event.preventDefault();
    const step = (event.shiftKey ? 10 : 1) * dir;
    const prev = latest.current;
    const horizontal = event.key === "ArrowLeft" || event.key === "ArrowRight";
    const next =
      kind === "hue"
        ? { ...prev, h: Math.max(0, Math.min(360, prev.h + step)) }
        : horizontal
        ? { ...prev, s: clamp01(prev.s + step / 100) }
        : { ...prev, v: clamp01(prev.v + step / 100) };
    keyHeld.current = true;
    pickFromHsv(next, false);
  };
  const keySettle = () => {
    if (!keyHeld.current) return;
    keyHeld.current = false;
    pickFromHsv(latest.current, true);
  };

  const commitHex = () => {
    const color = normalizeHex(hex);
    if (!color) return setHex(current.toUpperCase());
    setHex(color.toUpperCase());
    latest.current = hexToHsv(color);
    setHsv(latest.current);
    if (color !== current) onChange(color, true);
  };

  return (
    <>
      <div className="swatches">
        {CATEGORY_PALETTE.map((color) => (
          <button
            key={color}
            type="button"
            className={"sw-c" + (color === current ? " on" : "")}
            style={{ "--c": color }}
            data-tip={color}
            aria-label={color}
            aria-pressed={color === current}
            onClick={() => {
              setOpen(false);
              onChange(color, true);
            }}
          />
        ))}
        <button
          type="button"
          className={"sw-c custom" + (custom ? " on" : "")}
          style={{ "--c": custom ? current : "#fff" }}
          data-tip="직접 고르기"
          aria-label="직접 고르기"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {custom && <em style={{ background: current }} />}
        </button>
      </div>
      {open && (
        <div className="cpk">
          <div
            className="sv"
            role="slider"
            aria-label="채도와 밝기"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(hsv.v * 100)}
            aria-valuetext={hex}
            tabIndex={0}
            style={{ "--h": hsv.h }}
            onPointerDown={dragHandler(readSv)}
            onKeyDown={keyMove("sv")}
            onKeyUp={keySettle}
            onBlur={keySettle}
          >
            <i style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }} />
          </div>
          <div
            className="hue"
            role="slider"
            aria-label="색상"
            aria-valuemin={0}
            aria-valuemax={360}
            aria-valuenow={hsv.h}
            tabIndex={0}
            onPointerDown={dragHandler(readHue)}
            onKeyDown={keyMove("hue")}
            onKeyUp={keySettle}
            onBlur={keySettle}
          >
            <i style={{ left: `${(hsv.h / 360) * 100}%` }} />
          </div>
          <label className="hex">
            <span className="dot" style={{ background: current }} />
            <input
              aria-label="색 코드"
              value={hex}
              maxLength={7}
              spellCheck={false}
              onChange={(e) => setHex(e.target.value.toUpperCase())}
              onBlur={commitHex}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  e.stopPropagation();
                  commitHex();
                }
              }}
            />
          </label>
          {isLowContrast(current) && <p className="cpk-warn">어두운 바탕에서 잘 안 보일 수 있어요.</p>}
        </div>
      )}
    </>
  );
}
