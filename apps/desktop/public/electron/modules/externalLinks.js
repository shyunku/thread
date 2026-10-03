// Links the renderer may open in the system browser/mail client.
const CONTACT = "mailto:shyunku.support@gmail.com";

function isAllowedExternal(target) {
  if (typeof target !== "string" || target.length > 512) return false;
  if (target === CONTACT) return true;
  try {
    const url = new URL(target);
    return url.protocol === "https:" && !url.username && !url.password && !url.port &&
      (url.hostname === "threadapp.kr" || url.hostname.endsWith(".threadapp.kr"));
  } catch {
    return false;
  }
}

module.exports = { isAllowedExternal, CONTACT };
