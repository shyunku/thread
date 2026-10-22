import { anchorRect, placePopover } from "./placement";

const view = { width: 1000, height: 700 };
const rect = (left, top, width = 100, height = 30) => ({ left, top, right: left + width, bottom: top + height });

test("below the anchor, start-aligned", () => {
  expect(placePopover({ anchor: rect(100, 100), size: { width: 300, height: 400 }, view })).toEqual({ left: 100, top: 136, maxHeight: null, flipped: false });
});

test("end-aligned and kept 8px inside horizontally", () => {
  expect(placePopover({ anchor: rect(100, 100), size: { width: 300, height: 100 }, view, placement: "bottom-end" }).left).toBe(8);
  expect(placePopover({ anchor: rect(900, 100), size: { width: 300, height: 100 }, view }).left).toBe(692);
});

test("flips above when it does not fit below, else moves up into the window", () => {
  const up = placePopover({ anchor: rect(100, 600), size: { width: 300, height: 400 }, view });
  expect(up).toMatchObject({ top: 194, flipped: true });
  const shifted = placePopover({ anchor: rect(100, 300), size: { width: 300, height: 400 }, view });
  expect(shifted).toMatchObject({ top: 292, flipped: false, maxHeight: null });
});

test("taller than the window: capped with a scroll, 8px from both edges", () => {
  expect(placePopover({ anchor: rect(100, 100), size: { width: 300, height: 900 }, view })).toMatchObject({ top: 8, maxHeight: 684 });
});

test("held by its bottom edge (quick add): keeps the anchor and caps the height", () => {
  const fits = placePopover({ anchor: rect(40, 600, 600, 60), size: { width: 300, height: 400 }, view, placement: "top-start", gap: 8 });
  expect(fits).toEqual({ left: 40, top: 192, maxHeight: null, flipped: false });
  const capped = placePopover({ anchor: rect(40, 300, 600, 60), size: { width: 300, height: 500 }, view, placement: "top-start", gap: 8 });
  expect(capped).toMatchObject({ top: 8, maxHeight: 284 });
  expect(capped.top + capped.maxHeight).toBe(300 - 8);
});

test("at a point (context menu), moved inside the window", () => {
  const point = anchorRect({ x: 950, y: 650 });
  expect(placePopover({ anchor: point, size: { width: 236, height: 380 }, view, placement: "point" })).toMatchObject({ left: 756, top: 312 });
  // The date picker opened from the menu sits 40px above the pointer, never above 8px.
  expect(placePopover({ anchor: anchorRect({ x: 200, y: 20 }), size: { width: 300, height: 300 }, view, placement: "point", offset: { y: -40 } }).top).toBe(8);
  expect(placePopover({ anchor: anchorRect({ x: 200, y: 200 }), size: { width: 300, height: 300 }, view, placement: "point", offset: { y: -40 } }).top).toBe(160);
});

test("submenu: beside the item, flipped left near the right edge, moved up near the bottom", () => {
  const item = rect(500, 300, 224, 32);
  expect(placePopover({ anchor: item, size: { width: 230, height: 200 }, view, placement: "right-start", offset: { y: -6 } }))
    .toEqual({ left: 730, top: 294, maxHeight: null, flipped: false });
  const right = rect(700, 300, 224, 32);
  expect(placePopover({ anchor: right, size: { width: 230, height: 200 }, view, placement: "right-start", offset: { y: -6 } }))
    .toMatchObject({ left: 464, flipped: true });
  const low = rect(500, 600, 224, 32);
  expect(placePopover({ anchor: low, size: { width: 230, height: 200 }, view, placement: "right-start", offset: { y: -6 } }).top).toBe(492);
});

test("anchors: elements, refs, rects and points", () => {
  const el = { getBoundingClientRect: () => rect(1, 2, 3, 4) };
  expect(anchorRect(el)).toEqual(rect(1, 2, 3, 4));
  expect(anchorRect({ current: el })).toEqual(rect(1, 2, 3, 4));
  expect(anchorRect(rect(5, 6))).toEqual(rect(5, 6));
  expect(anchorRect({ x: 7, y: 8 })).toMatchObject({ left: 7, right: 7, top: 8, bottom: 8 });
});

test("flip: false never flips above; a popup that does not fit below moves up whole, uncapped", () => {
  const fits = placePopover({ anchor: rect(100, 100), size: { width: 300, height: 400 }, view, flip: false });
  expect(fits).toEqual({ left: 100, top: 136, maxHeight: null, flipped: false });
  // Room above too, but it stays on its side: moved up over the anchor instead of capped.
  const kept = placePopover({ anchor: rect(100, 600), size: { width: 300, height: 400 }, view, flip: false });
  expect(kept).toEqual({ left: 100, top: 292, maxHeight: null, flipped: false });
  const tight = placePopover({ anchor: rect(100, 300), size: { width: 300, height: 500 }, view, flip: false });
  expect(tight).toEqual({ left: 100, top: 192, maxHeight: null, flipped: false });
  // Only taller than the window: capped, 8px from both edges.
  expect(placePopover({ anchor: rect(100, 300), size: { width: 300, height: 900 }, view, flip: false })).toMatchObject({ top: 8, maxHeight: 684 });
});

test("the detail 기한 picker in a short window (mock fitPopups): shifted up over its row, never cut", () => {
  // 960×720 and 760×640: the row at 153–193, the picker 538 tall.
  const row = { left: 1112, right: 1388, top: 153, bottom: 193 };
  expect(placePopover({ anchor: row, size: { width: 276, height: 538 }, view: { width: 960, height: 720 } })).toMatchObject({ top: 174, maxHeight: null });
  expect(placePopover({ anchor: row, size: { width: 276, height: 538 }, view: { width: 760, height: 640 } })).toMatchObject({ top: 94, maxHeight: null });
  // Re-placed later (kept below): the same spot.
  expect(placePopover({ anchor: row, size: { width: 276, height: 538 }, view: { width: 760, height: 640 }, flip: false })).toMatchObject({ top: 94, maxHeight: null });
});
