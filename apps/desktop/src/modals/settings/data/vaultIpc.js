import IpcSender from "../../../utils/IpcSender";

// Promise wrapper over IpcSender.vault.<method>(...args, callback).
// Main collapses most failures into VAULT_ACTION_FAILED; callers show generic guidance.
export function vaultCall(method, ...args) {
  return new Promise((resolve, reject) => {
    const fn = IpcSender.vault?.[method];
    if (typeof fn !== "function") return reject(Error("UNAVAILABLE"));
    fn(...args, (response) =>
      response?.success ? resolve(response.data) : reject(Error(response?.data?.code || "VAULT_ACTION_FAILED")));
  });
}

// Grouped actions: rotation, backup, pairing, reencryption, lostRecovery.
export const vaultAction = (group, action, input = {}) => vaultCall(group, action, input);
