import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useSecretSession } from "../hooks/useSecretSession";
import "./SecretLock.scss";

// The top bar's place right of the search (TopBar.js); the main screen fills it.
export const TOP_BAR_SLOT_ID = "top-bar-slot";

const LockIcon = ({ open }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="5" y="11" width="14" height="10" rx="2.5" />
    <path d={open ? "M8 11V8a4 4 0 0 1 7.6-1.7" : "M8 11V8a4 4 0 0 1 8 0v3"} />
  </svg>
);

// One lock for the secret categories (#104), separate from the vault lock. Open: the secret
// categories and their tasks show everywhere. Locked: they are hidden, the sidebar rows too.
// Opening asks the way the vault opens (useSecretSession); locking is immediate. A secret
// category on screen when it locks gives way to 모든 할 일 (onHide).
export default function SecretLock({ hasSecret, onSecretScreen, onHide }) {
  const secret = useSecretSession();
  const [slot, setSlot] = useState(() => document.getElementById(TOP_BAR_SLOT_ID));
  useEffect(() => {
    if (!slot) setSlot(document.getElementById(TOP_BAR_SLOT_ID));
  }, [slot]);

  useEffect(() => {
    if (!secret.unlocked && onSecretScreen) onHide?.();
  }, [secret.unlocked, onSecretScreen, onHide]);

  // No secret category: nothing to lock (an open lock stays until it is closed).
  if (!slot || (!hasSecret && !secret.unlocked)) return null;
  const open = secret.unlocked;
  const label = open ? "비밀 카테고리 잠그기" : "비밀 카테고리 잠금 풀기";
  return createPortal(
    <button
      type="button"
      className={"secret-lock" + (open ? " on" : "")}
      aria-label={label}
      aria-pressed={open}
      data-tip={label}
      onClick={() => (open ? secret.lock() : secret.unlock({}))}
    >
      <LockIcon open={open} />
    </button>,
    slot
  );
}
