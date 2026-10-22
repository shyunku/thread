// Moves focus between the rows of a list with the arrow keys (Home/End too).
export function moveFocus(event, container, selector) {
  const keys = { ArrowDown: 1, ArrowUp: -1, Home: "first", End: "last" };
  if (!(event.key in keys) || !container) return false;
  const rows = [...container.querySelectorAll(selector)].filter((el) => !el.disabled);
  if (!rows.length) return false;
  event.preventDefault();
  const index = rows.indexOf(document.activeElement);
  const step = keys[event.key];
  const next = step === "first" ? 0 : step === "last" ? rows.length - 1
    : index < 0 ? (step > 0 ? 0 : rows.length - 1) : (index + step + rows.length) % rows.length;
  rows[next].focus();
  return true;
}
