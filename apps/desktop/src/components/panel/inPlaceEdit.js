import { useEffect, useRef, useState } from "react";

// Korean input: Enter and Esc while composing belong to the IME.
export const composing = (event) => event.nativeEvent?.isComposing || event.keyCode === 229;

// Line breaks (pasted text) become spaces in a one-line value.
export const oneLine = (text) => text.replace(/\s*[\r\n]+\s*/g, " ");

// A text field that edits in place: Enter (not while composing Korean) and leaving save, Esc
// puts the text back. Esc is taken here so it neither closes the drawer nor clears the selection.
// Only text the user changed is saved: until then the field follows `value` (a change synced
// from elsewhere, also while the field only has focus), so a blur cannot write an old text back.
// singleLine: pasted line breaks become spaces. flushOnExit: a changed text is also saved when
// the field goes away (the panel switches task) or the window closes.
export function useInPlaceEdit(value, onSave, { allowEmpty = false, singleLine = false, flushOnExit = false } = {}) {
  const [draft, setDraft] = useState(value ?? "");
  const dirty = useRef(false);
  const cancelled = useRef(false);
  const latest = useRef(null);
  latest.current = { draft, value, onSave, allowEmpty };
  useEffect(() => {
    if (!dirty.current) setDraft(value ?? "");
  }, [value]);

  // Saves a changed text once. A change that cannot be saved (empty, or the same) goes back.
  const save = () => {
    if (!dirty.current) return;
    dirty.current = false;
    const { draft: raw, value: current, onSave: send, allowEmpty: empty } = latest.current;
    const text = raw.trim();
    if ((text || empty) && text !== (current ?? "").trim()) send(text);
    else setDraft(current ?? "");
  };

  useEffect(() => {
    if (!flushOnExit) return undefined;
    const onExit = () => save();
    window.addEventListener("pagehide", onExit);
    window.addEventListener("beforeunload", onExit);
    return () => {
      window.removeEventListener("pagehide", onExit);
      window.removeEventListener("beforeunload", onExit);
      onExit();
    };
    // save reads the latest values through the ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flushOnExit]);

  return {
    value: draft,
    onChange: (event) => {
      dirty.current = true;
      setDraft(singleLine ? oneLine(event.target.value) : event.target.value);
    },
    onBlur: () => {
      if (cancelled.current) {
        cancelled.current = false;
        dirty.current = false;
        setDraft(value ?? "");
        return;
      }
      save();
    },
    onKeyDown: (event) => {
      if (event.key === "Enter" && !composing(event)) {
        event.preventDefault();
        event.currentTarget.blur();
      } else if (event.key === "Escape" && !composing(event)) {
        event.preventDefault();
        cancelled.current = true;
        event.currentTarget.blur();
      }
    },
  };
}
