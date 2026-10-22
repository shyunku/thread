// Category colours (#102): the palette of the sidebar menus and the custom picker maths.
export const CATEGORY_PALETTE = [
  "#6294ff",
  "#4fc3d9",
  "#44c98b",
  "#9ccc65",
  "#f2c14e",
  "#ff9f5a",
  "#f0838b",
  "#f06292",
  "#e57ad6",
  "#b58cff",
  "#8a93a3",
];

// Shown for categories saved without a colour (older desktop builds).
export const FALLBACK_CATEGORY_COLOR = "#6294ff";
// The surface the colours sit on; below 3:1 against it the picker warns.
export const CONTRAST_SURFACE = "#1a1e25";

export const isHexColor = (value) => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);

export const normalizeHex = (value) => {
  if (typeof value !== "string") return null;
  let hex = value.trim().toLowerCase();
  if (!hex.startsWith("#")) hex = "#" + hex;
  if (/^#[0-9a-f]{3}$/.test(hex)) hex = "#" + [...hex.slice(1)].map((c) => c + c).join("");
  return isHexColor(hex) ? hex : null;
};

export const categoryColor = (category) => normalizeHex(category?.color) || FALLBACK_CATEGORY_COLOR;

export const inPalette = (color) => CATEGORY_PALETTE.includes(normalizeHex(color));

// The first palette colour no category uses yet (the first one when all are taken).
export function nextPaletteColor(categories) {
  const used = new Set(
    Object.values(categories ?? {}).map((category) => normalizeHex(category?.color)).filter(Boolean)
  );
  return CATEGORY_PALETTE.find((color) => !used.has(color)) || CATEGORY_PALETTE[0];
}

const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

export const isLowContrast = (color) => contrastRatio(color, CONTRAST_SURFACE) < 3;

// h 0–360, s and v 0–1.
export function hsvToHex(h, s, v) {
  const f = (n) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return "#" + [f(5), f(3), f(1)].map((x) => Math.round(x * 255).toString(16).padStart(2, "0")).join("");
}

export function hexToHsv(hex) {
  const [r, g, b] = hexToRgb(normalizeHex(hex) || FALLBACK_CATEGORY_COLOR).map((v) => v / 255);
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = Math.round(h * 60);
    if (h < 0) h += 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}
