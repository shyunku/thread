const fs = require("fs");
const os = require("os");
const path = require("path");
const { loadWindowState, saveWindowState, placeWindow, sanitize } = require("../../public/electron/modules/windowState");

const primary = { x: 0, y: 0, width: 1920, height: 1040 };
const second = { x: 1920, y: 0, width: 2560, height: 1400 };

describe("window state (#106)", () => {
  test("keeps a window that is on a connected display", () => {
    expect(placeWindow({ x: 100, y: 80, width: 1440, height: 960 }, [primary, second], primary)).toEqual({ x: 100, y: 80, width: 1440, height: 960 });
    expect(placeWindow({ x: 2100, y: 100, width: 1440, height: 960 }, [primary, second], primary)).toEqual({ x: 2100, y: 100, width: 1440, height: 960 });
  });

  test("brings back a window left on an unplugged display", () => {
    expect(placeWindow({ x: 2100, y: 100, width: 1440, height: 960 }, [primary], primary)).toEqual({ x: 480, y: 80, width: 1440, height: 960 });
  });

  test("shrinks a window larger than the display", () => {
    expect(placeWindow({ x: 1500, y: 900, width: 3000, height: 2000 }, [primary], primary)).toEqual(primary);
  });

  test("rejects broken values", () => {
    expect(sanitize(null)).toBeNull();
    expect(sanitize({ x: 0, y: 0, width: 10, height: 500 })).toBeNull();
    expect(sanitize({ x: "1", y: 0, width: 800, height: 600 })).toBeNull();
    expect(sanitize({ x: 1.4, y: 2, width: 800, height: 600, maximized: "yes" })).toEqual({ x: 1, y: 2, width: 800, height: 600, maximized: false });
  });

  test("saves and loads through userData", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "thread-window-"));
    const app = { getPath: () => dir };
    try {
      expect(loadWindowState(app)).toBeNull();
      expect(saveWindowState(app, { x: 10, y: 20, width: 1200, height: 800, maximized: true })).toBe(true);
      expect(loadWindowState(app)).toEqual({ x: 10, y: 20, width: 1200, height: 800, maximized: true });
      fs.writeFileSync(path.join(dir, "window-state.json"), "{not json");
      expect(loadWindowState(app)).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
