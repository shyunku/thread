// Where a popup goes (#102, mock fitPopups/fitSub). Pure functions in window coordinates.
export const POPUP_MARGIN = 8; // popups stay this far inside the app window
const MIN_ROOM = 160; // below this a kept-below popup moves up instead of shrinking

// An anchor as a rect: an element, a ref to one, a DOMRect-like box or a point {x, y}.
export function anchorRect(anchor) {
  const el = anchor && "current" in anchor ? anchor.current : anchor;
  if (el && typeof el.getBoundingClientRect === "function") return el.getBoundingClientRect();
  if (el && Number.isFinite(el.x) && !Number.isFinite(el.left)) return { left: el.x, right: el.x, top: el.y, bottom: el.y, width: 0, height: 0 };
  return el || { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 };
}

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// placement:
//   "bottom-start" / "bottom-end": under the anchor; above it when it does not fit below,
//     else moved up into the window.
//   "top-start" / "top-end": above the anchor, held by its bottom edge (the quick-add box):
//     when too tall it keeps the anchor and caps its height instead of moving.
//   "point": its top-left corner at the anchor point, moved into the window.
//   "right-start": a submenu beside the anchor item, flipped to the left side when it would
//     leave the window, moved up when it would cross the bottom.
// offset {x, y} moves the anchor first (e.g. the context menu's date picker sits 40px higher).
// flip: false keeps a "bottom" popup below its anchor (Popover passes it once the first
// placement chose below, so paging a month or filtering a list does not make it jump to the
// other side); it caps the height to the room below instead, or moves up when that room is
// too small (under MIN_ROOM).
// Returns { left, top, maxHeight, flipped } where maxHeight is null when the popup fits.
export function placePopover({ anchor, size, view, placement = "bottom-start", gap = 6, margin = POPUP_MARGIN, offset, flip = true }) {
  const dx = offset?.x || 0, dy = offset?.y || 0;
  const a = { left: anchor.left + dx, right: anchor.right + dx, top: anchor.top + dy, bottom: anchor.bottom + dy };
  const [side, align = "start"] = placement.split("-");
  const room = Math.max(0, view.height - 2 * margin);
  let height = Math.min(size.height, room);
  let maxHeight = size.height > room ? room : null;
  let top, left, flipped = false;

  if (side === "top") {
    const bottom = a.top - gap;
    if (bottom - height < margin) {
      height = Math.max(0, bottom - margin);
      maxHeight = height;
    }
    top = bottom - height;
  } else if (side === "bottom") {
    top = a.bottom + gap;
    if (top + height > view.height - margin) {
      const above = a.top - gap - height;
      const below = view.height - margin - top;
      if (!flip && below >= MIN_ROOM) { height = below; maxHeight = below; }
      else if (flip && above >= margin) { top = above; flipped = true; } else top = view.height - margin - height;
    }
  } else {
    top = a.top;
    if (top + height > view.height - margin) top = view.height - margin - height;
  }
  top = Math.max(margin, top);

  if (side === "right") {
    left = a.right + gap;
    if (left + size.width > view.width - margin) { left = a.left - gap - size.width; flipped = true; }
  } else {
    left = align === "end" ? a.right - size.width : a.left;
  }
  left = clamp(left, margin, Math.max(margin, view.width - margin - size.width));
  return { left: Math.round(left), top: Math.round(top), maxHeight: maxHeight === null ? null : Math.floor(maxHeight), flipped };
}
