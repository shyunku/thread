import { useEffect, useState } from "react";

// Signed update repository served by RMS. The site only reads public metadata
// to show the latest installer; the app itself verifies signatures when updating.
export const RMS_ENTRY = (process.env.REACT_APP_RMS_ENTRY || "https://rms.threadapp.kr").replace(/\/+$/, "");

const VERSION = /^(\d+)\.(\d+)\.(\d+)$/;

function compare(a, b) {
  const x = a.match(VERSION).slice(1).map(Number), y = b.match(VERSION).slice(1).map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

// Picks the newest stable Windows x64 installer from TUF targets metadata.
export function latestWindowsRelease(targetsMetadata) {
  const targets = targetsMetadata?.signed?.targets;
  if (!targets || typeof targets !== "object") return null;
  let best = null;
  for (const [name, target] of Object.entries(targets)) {
    const meta = target?.custom?.thread;
    if (!meta || meta.platform !== "win" || meta.arch !== "x64" || typeof meta.version !== "string") continue;
    if (!VERSION.test(meta.version) || name !== `win/x64/${meta.version}/installer.exe`) continue;
    if (!Number.isSafeInteger(target.length) || typeof target.hashes?.sha256 !== "string") continue;
    if (!best || compare(meta.version, best.version) > 0) {
      best = { version: meta.version, size: target.length, sha256: target.hashes.sha256, url: `${RMS_ENTRY}/tuf/targets/${name}` };
    }
  }
  return best;
}

export function useLatestRelease() {
  const [state, setState] = useState({ status: "loading", release: null });
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${RMS_ENTRY}/tuf/metadata/targets.json`, { signal: controller.signal, cache: "no-store" })
      .then((response) => (response.ok ? response.json() : Promise.reject(Error(String(response.status)))))
      .then((metadata) => {
        const release = latestWindowsRelease(metadata);
        setState(release ? { status: "ready", release } : { status: "error", release: null });
      })
      .catch(() => { if (!controller.signal.aborted) setState({ status: "error", release: null }); });
    return () => controller.abort();
  }, []);
  return state;
}

export function formatSize(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(0)}MB`;
}
