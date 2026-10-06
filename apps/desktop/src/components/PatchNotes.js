import { useEffect, useRef, useState } from "react";
import { IoCheckmark, IoChevronDown, IoSparklesOutline } from "react-icons/io5";
import PackageJson from "../../package.json";
import IpcSender from "utils/IpcSender";
import { COLLAPSE_AT, KIND_LABEL, pendingNotes, platformNotes, visibleNotes } from "utils/patchNotes";
import "./PatchNotes.scss";

export const OPEN_PATCH_NOTES = "thread:open-patch-notes";

function Sections({ note }) {
  return note.sections.map((section) => (
    <div key={section.kind} className="patch-notes__section">
      <span className={`patch-notes__kind patch-notes__kind--${section.kind}`}>{KIND_LABEL[section.kind]}</span>
      {section.items.map((item, index) => (
        <div key={index} className="patch-notes__item">
          <strong>{item.title}</strong>
          {item.detail?.map((line, i) => <span key={i}>{line}</span>)}
        </div>
      ))}
    </div>
  ));
}

function FullVersion({ note }) {
  return (
    <div className="patch-notes__version">
      <div className="patch-notes__version-head"><strong>{note.version}</strong><span>{note.date}</span></div>
      <p className="patch-notes__summary">{note.summary}</p>
      <Sections note={note} />
    </div>
  );
}

function VersionCard({ note, current, open, onToggle }) {
  return (
    <div className={"patch-notes__card" + (open ? " patch-notes__card--open" : "")}>
      <button type="button" className="patch-notes__card-head" aria-expanded={open} onClick={onToggle}>
        <span className="patch-notes__card-text">
          <span className="patch-notes__version-head">
            <strong>{note.version}</strong>
            {current && <span className="patch-notes__badge">현재</span>}
            <span>{note.date}</span>
          </span>
          <span className="patch-notes__summary">{note.summary}</span>
        </span>
        <span className="patch-notes__expand" aria-hidden="true"><IoChevronDown /></span>
      </button>
      {open && <div className="patch-notes__card-body"><Sections note={note} /></div>}
    </div>
  );
}

// The window shown once after an update, and the update history opened from Settings (#99).
// preview: { mode, notes, seen } renders synthetic notes without IPC (dev previews).
export default function PatchNotes({ preview = null }) {
  const current = PackageJson.version;
  const [view, setView] = useState(preview ? { mode: preview.mode, notes: preview.mode === "history" ? preview.notes : pendingNotes(preview.notes, preview.seen ?? null, current) } : null);
  const [dontShow, setDontShow] = useState(false);
  const [expanded, setExpanded] = useState(() => new Set());
  const dialog = useRef(null);
  const all = visibleNotes(preview ? preview.notes : platformNotes(), current);

  useEffect(() => {
    if (preview) return;
    let active = true;
    const markSeen = () => IpcSender.patchNotes.seen(() => {});
    IpcSender.patchNotes.state(({ success, data }) => {
      if (!active || !success || !data) return;
      const pending = pendingNotes(platformNotes(), data.seen, current);
      if (!pending.length) {
        if (data.seen !== current) markSeen();
        return;
      }
      IpcSender.appSettings.get(({ success: ok, data: settings }) => {
        if (!active) return;
        if (ok && settings?.showPatchNotes === false) markSeen();
        else setView((old) => old || { mode: "update", notes: pending });
      });
    });
    return () => { active = false; };
  }, [preview, current]);

  useEffect(() => {
    const open = () => { setExpanded(new Set()); setView({ mode: "history", notes: all }); };
    window.addEventListener(OPEN_PATCH_NOTES, open);
    return () => window.removeEventListener(OPEN_PATCH_NOTES, open);
  }, [all]);

  useEffect(() => {
    if (!view) return;
    const previous = document.activeElement;
    dialog.current?.focus();
    return () => previous?.focus?.();
  }, [view?.mode]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!view) return null;
  const update = view.mode === "update";
  // Leaving the after-update window records the running version as shown.
  const finishUpdate = () => {
    if (preview) return;
    IpcSender.patchNotes.seen(() => {});
    if (dontShow) IpcSender.appSettings.set({ showPatchNotes: false }, () => {});
  };
  const close = () => {
    if (update) finishUpdate();
    setView(null);
  };
  const showHistory = () => {
    finishUpdate();
    setExpanded(new Set());
    setView({ mode: "history", notes: all });
  };
  const toggle = (version) => setExpanded((old) => {
    const next = new Set(old);
    if (next.has(version)) next.delete(version); else next.add(version);
    return next;
  });
  const cards = !update || view.notes.length >= COLLAPSE_AT;
  const eyebrow = update && view.notes.length > 1 ? `버전 ${current} · 업데이트 ${view.notes.length}개` : `버전 ${current}`;

  return (
    <div className="patch-notes-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <section ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="patch-notes-title" className="patch-notes"
        onKeyDown={(event) => {
          if (event.key === "Escape") { event.preventDefault(); close(); return; }
          if (event.key !== "Tab") return;
          const items = [...event.currentTarget.querySelectorAll("button:not(:disabled), input:not(:disabled)")];
          if (!items.length) return;
          const index = items.indexOf(document.activeElement);
          event.preventDefault();
          items[(index + (event.shiftKey ? -1 : 1) + items.length) % items.length].focus();
        }}>
        <div className="patch-notes__heading">
          <span className="patch-notes__symbol" aria-hidden="true"><IoSparklesOutline /></span>
          <div>
            <span className="patch-notes__eyebrow">{eyebrow}</span>
            <h2 id="patch-notes-title">{update ? "업데이트를 완료했어요" : "업데이트 내역"}</h2>
          </div>
        </div>
        <div className="patch-notes__body">
          {!view.notes.length ? <p className="patch-notes__empty">아직 업데이트 내역이 없어요.</p>
            : cards ? view.notes.map((note) => (
              <VersionCard key={note.version} note={note} current={!update && note.version === current}
                open={expanded.has(note.version)} onToggle={() => toggle(note.version)} />
            ))
            : view.notes.map((note) => <FullVersion key={note.version} note={note} />)}
        </div>
        <div className="patch-notes__foot">
          {update && (
            <label className={"patch-notes__check" + (dontShow ? " patch-notes__check--on" : "")}>
              <input type="checkbox" checked={dontShow} onChange={(event) => setDontShow(event.target.checked)} />
              <span className="patch-notes__box" aria-hidden="true">{dontShow && <IoCheckmark />}</span>
              다시 보지 않기
            </label>
          )}
          <span className="patch-notes__grow" />
          {update && <button type="button" className="patch-notes__secondary" onClick={showHistory}>전체 내역</button>}
          <button type="button" autoFocus onClick={close}>{update ? "확인" : "닫기"}</button>
        </div>
      </section>
    </div>
  );
}
