import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import ConfirmDialog from "../molecules/pickers/ConfirmDialog";
import Toast from "../molecules/Toast";
import IpcSender from "../utils/IpcSender";

// Secret categories for this app run (#102). Never persisted: the unlock lasts until the
// app closes or the vault locks, and the eye toggle (showSecret) starts off every run.
// The user is confirmed the way the vault opens: OS auth (Windows Hello / Touch ID) when
// the vault uses it, otherwise the vault password. Both ask in the main-screen dialog
// (ConfirmDialog, mock .hello).
const SecretSessionContext = createContext({
  unlocked: false,
  showSecret: false,
  method: null,
  unlock: () => Promise.resolve(false),
  probeMethod: () => {},
  setShowSecret: () => Promise.resolve(false),
  toggleShowSecret: () => Promise.resolve(false),
  lock: () => {},
});

export const osAuthName = () =>
  typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent || "") ? "Touch ID" : "Windows Hello";

// "열 때 … 확인해요" under the secret checkbox, by the method last seen (generic before).
export function secretMethodLine(method) {
  if (method === "os") return `열 때 ${osAuthName()}로 확인해요`;
  if (method === "password") return "열 때 보관함 비밀번호로 확인해요";
  return "열 때 본인 확인을 해요";
}

const DIALOG_TITLE = "비밀 카테고리를 볼까요?";
const dialogText = (method) =>
  `${method === "os" ? osAuthName() : "보관함 비밀번호"}로 본인 확인을 해요. 앱을 닫거나 잠글 때까지 다시 묻지 않아요.`;
const FAILED = "잠금을 풀 수 없어요.";
const BUSY = "잠시 뒤에 다시 해 주세요.";
const WRONG = "비밀번호가 맞지 않아요.";
// The vault answers BUSY while another check (or vault action) runs; OS auth has its own.
const isBusy = (data) => data?.code === "BUSY" || data?.code === "OS_AUTH_BUSY";

// The method the vault confirms with, from an answer: OS auth first, then the password.
const methodOf = (data) => (data?.osAvailable ? "os" : data?.passwordAvailable ? "password" : null);

export function SecretSessionProvider({ uid, children }) {
  const [unlocked, setUnlocked] = useState(false);
  const [showSecret, setShowSecretState] = useState(false);
  const [method, setMethod] = useState(null);
  const [dialog, setDialog] = useState(null);
  const unlockedRef = useRef(false);
  const pendingRef = useRef(null);
  const finishRef = useRef(null);
  const generationRef = useRef(0);
  const probingRef = useRef(false);

  const lock = useCallback(() => {
    generationRef.current++;
    unlockedRef.current = false;
    // An ask still open ends as "not unlocked".
    finishRef.current?.(false);
    pendingRef.current = null;
    setUnlocked(false);
    setShowSecretState(false);
    setDialog(null);
  }, []);

  // A vault lock (screen lock, suspend, 잠그기) locks the secret categories again.
  useEffect(() => IpcSender.vault?.onLocked?.(uid ?? null, lock), [uid, lock]);

  // The vault password in the dialog's field; a wrong one keeps the dialog with a line.
  const askPassword = useCallback((finish, color) => {
    const check = (_id, password) => {
      setDialog((d) => d && { ...d, busy: true, error: null });
      IpcSender.vault.verifyUser({ method: "password", password: password ?? "" }, ({ success, data } = {}) => {
        if (success && data?.verified) return finish(true);
        if (!success) {
          Toast.error(FAILED);
          return finish(false);
        }
        setDialog((d) => d && { ...d, busy: false, error: isBusy(data) ? BUSY : WRONG });
      });
    };
    setDialog({ kind: "password", color, busy: false, error: null, confirm: check, cancel: () => finish(false) });
  }, []);

  const verifyOs = useCallback(
    (finish, color, passwordAvailable) => {
      IpcSender.vault.verifyUser({ method: "os" }, ({ success, data } = {}) => {
        if (success && data?.verified) return finish(true);
        // Cancelling the OS prompt is silent; a failed or missing OS check falls back to the
        // vault password when there is one.
        if (success && data?.code === "OS_AUTH_CANCELLED") return finish(false);
        if (success && isBusy(data)) {
          Toast.warn(BUSY);
          return finish(false);
        }
        if (success && (data?.passwordAvailable ?? passwordAvailable)) return askPassword(finish, color);
        Toast.error(FAILED);
        finish(false);
      });
    },
    [askPassword]
  );

  // Resolves true once unlocked; asks at most once at a time. `color` tints the dialog icon
  // (the category being opened).
  const unlock = useCallback(({ color } = {}) => {
    if (unlockedRef.current) return Promise.resolve(true);
    if (pendingRef.current) return pendingRef.current;
    const generation = generationRef.current;
    const promise = new Promise((resolve) => {
      let done = false;
      const finish = (ok) => {
        if (done) return;
        done = true;
        if (finishRef.current === finish) finishRef.current = null;
        setDialog(null);
        resolve(ok && generation === generationRef.current);
      };
      finishRef.current = finish;
      // Which way does the vault confirm the user? A password check with no password is
      // refused before any real check, and the answer says what is available.
      IpcSender.vault.verifyUser({ method: "password" }, ({ success, data } = {}) => {
        if (done) return;
        if (success && isBusy(data)) {
          Toast.warn(BUSY);
          return finish(false);
        }
        // A probe never unlocks; a "verified" answer to it is not trusted.
        const next = success && data && !data.verified ? methodOf(data) : null;
        if (!next) {
          Toast.error(FAILED);
          return finish(false);
        }
        setMethod(next);
        if (next === "password") return askPassword(finish, color);
        setDialog({
          kind: "os",
          color,
          confirm: () => {
            setDialog(null);
            verifyOs(finish, color, data.passwordAvailable);
          },
          cancel: () => finish(false),
        });
      });
    }).then((ok) => {
      if (pendingRef.current === promise) pendingRef.current = null;
      if (ok) {
        unlockedRef.current = true;
        setUnlocked(true);
      }
      return ok;
    });
    pendingRef.current = promise;
    return promise;
  }, [askPassword, verifyOs]);

  // Learns the method without asking (the ＋ popup's "열 때 … 확인해요" line).
  const probeMethod = useCallback(() => {
    if (method || probingRef.current || !IpcSender.vault?.verifyUser) return;
    probingRef.current = true;
    IpcSender.vault.verifyUser({ method: "password" }, ({ success, data } = {}) => {
      probingRef.current = false;
      const next = success && data && !data.verified ? methodOf(data) : null;
      if (next) setMethod(next);
    });
  }, [method]);

  // Turning the eye on asks for the unlock once.
  const setShowSecret = useCallback(
    async (next) => {
      if (!next) {
        setShowSecretState(false);
        return false;
      }
      const ok = await unlock({});
      if (ok) setShowSecretState(true);
      return ok;
    },
    [unlock]
  );
  const toggleShowSecret = useCallback(() => setShowSecret(!showSecret), [setShowSecret, showSecret]);

  const value = useMemo(
    () => ({ unlocked, showSecret, method, unlock, probeMethod, setShowSecret, toggleShowSecret, lock }),
    [unlocked, showSecret, method, unlock, probeMethod, setShowSecret, toggleShowSecret, lock]
  );

  return createElement(
    SecretSessionContext.Provider,
    { value },
    children,
    dialog &&
      createElement(ConfirmDialog, {
        key: dialog.kind,
        icon: "shield",
        iconColor: dialog.color || "var(--accent)",
        title: DIALOG_TITLE,
        body: dialogText(dialog.kind),
        input:
          dialog.kind === "password"
            ? { type: "password", label: "보관함 비밀번호", placeholder: "보관함 비밀번호" }
            : undefined,
        busy: !!dialog.busy,
        error: dialog.error,
        choices: [{ id: "confirm", label: "확인" }],
        onChoose: dialog.confirm,
        onCancel: dialog.cancel,
      })
  );
}

export function useSecretSession() {
  return useContext(SecretSessionContext);
}
