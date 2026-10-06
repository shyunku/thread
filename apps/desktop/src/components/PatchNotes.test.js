import { act, fireEvent, render, screen } from "@testing-library/react";
import PatchNotes, { OPEN_PATCH_NOTES } from "./PatchNotes";
import IpcSender from "../utils/IpcSender";
import { compareVersions, pendingNotes, visibleNotes } from "../utils/patchNotes";

const note = (version, extra = {}) => ({
  version, date: "2026-10-20", summary: `${version} 요약`,
  sections: [{ kind: "fixed", items: [{ title: `${version} 문제를 고쳤어요.`, detail: ["한 줄.", "두 줄."] }] }],
  ...extra,
});
// The running version is package.json's; notes around it are synthetic.
const CURRENT = require("../../package.json").version;
const [major, minor, patch] = CURRENT.split(".").map(Number);
const older = (n) => `${major}.${minor}.${patch - n}`;
jest.mock("../generated/patchNotes.json", () => {
  const [a, b, c] = require("../../package.json").version.split(".").map(Number);
  const make = (v) => ({ version: v, date: "2026-10-20", summary: `${v} 요약`,
    sections: [{ kind: "fixed", items: [{ title: `${v} 문제를 고쳤어요.`, detail: ["한 줄.", "두 줄."] }] }] });
  return { win: [0, 1, 2, 3, 4, 5, 6].map((n) => make(`${a}.${b}.${c + 1 - n}`)).filter((x) => !x.version.includes("-")).slice(1), mac: [] };
});
let mockState = { seen: null };
let mockSettings = { showPatchNotes: true };
jest.mock("../utils/IpcSender", () => ({
  patchNotes: { state: jest.fn(), seen: jest.fn() },
  appSettings: { get: jest.fn(), set: jest.fn() },
}));

// CRA resets mock implementations before each test.
beforeEach(() => {
  mockSettings = { showPatchNotes: true };
  IpcSender.patchNotes.state.mockImplementation((cb) => cb({ success: true, data: mockState }));
  IpcSender.patchNotes.seen.mockImplementation((cb) => cb({ success: true }));
  IpcSender.appSettings.get.mockImplementation((cb) => cb({ success: true, data: mockSettings }));
  IpcSender.appSettings.set.mockImplementation((patch, cb) => cb({ success: true }));
});

test("versions compare numerically and pending notes stop at the running version", () => {
  expect(compareVersions("2.0.10", "2.0.9")).toBeGreaterThan(0);
  expect(compareVersions("2.1.0-beta.1", "2.1.0")).toBeLessThan(0);
  const notes = [note("2.0.12"), note("2.0.11"), note("2.0.10"), note("2.0.9")];
  expect(pendingNotes(notes, "2.0.9", "2.0.11").map((x) => x.version)).toEqual(["2.0.11", "2.0.10"]);
  expect(pendingNotes(notes, null, "2.0.11").map((x) => x.version)).toEqual(["2.0.11"]);
  expect(pendingNotes(notes, "2.0.11", "2.0.11")).toEqual([]);
  // Official builds hide beta notes (the official notes include them) and future drafts.
  const mixed = ["2.2.0", "2.1.0", "2.1.0-beta.2", "2.1.0-beta.1", "2.0.9"].map(note);
  expect(visibleNotes(mixed, "2.1.0").map((x) => x.version)).toEqual(["2.1.0", "2.0.9"]);
  expect(visibleNotes(mixed, "2.1.0-beta.2").map((x) => x.version)).toEqual(["2.1.0-beta.2", "2.1.0-beta.1", "2.0.9"]);
  expect(pendingNotes(mixed, "2.1.0-beta.2", "2.1.0").map((x) => x.version)).toEqual(["2.1.0"]);
});

test("after an update the window lists unseen versions once; 다시 보지 않기 turns the setting off", () => {
  mockState = { seen: older(2) };
  render(<PatchNotes />);
  const dialog = screen.getByRole("dialog");
  expect(dialog).toHaveTextContent("업데이트를 완료했어요");
  expect(dialog).toHaveTextContent(`업데이트 2개`);
  expect(dialog).toHaveTextContent(`${CURRENT} 문제를 고쳤어요.`);
  expect(dialog).toHaveTextContent(`${older(1)} 문제를 고쳤어요.`);
  expect(dialog).not.toHaveTextContent(`${older(2)} 요약`);
  fireEvent.click(screen.getByLabelText("다시 보지 않기"));
  fireEvent.click(screen.getByText("확인"));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(IpcSender.patchNotes.seen).toHaveBeenCalledTimes(1);
  expect(IpcSender.appSettings.set).toHaveBeenCalledWith({ showPatchNotes: false }, expect.any(Function));
});

test("five or more unseen versions are collapsed cards that expand", () => {
  mockState = { seen: older(6) };
  render(<PatchNotes />);
  const dialog = screen.getByRole("dialog");
  expect(dialog).toHaveTextContent(`${older(5)} 요약`);
  expect(dialog).not.toHaveTextContent(`${CURRENT} 문제를 고쳤어요.`);
  fireEvent.click(screen.getByText(`${CURRENT} 요약`));
  expect(dialog).toHaveTextContent(`${CURRENT} 문제를 고쳤어요.`);
  fireEvent.click(screen.getByText("전체 내역"));
  expect(screen.getByRole("dialog")).toHaveTextContent("업데이트 내역");
  expect(IpcSender.patchNotes.seen).toHaveBeenCalledTimes(1);
});

test("nothing shows when the setting is off, already seen, or on a new install", () => {
  mockSettings = { showPatchNotes: false };
  mockState = { seen: older(1) };
  const first = render(<PatchNotes />);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(IpcSender.patchNotes.seen).toHaveBeenCalledTimes(1);
  first.unmount();
  IpcSender.patchNotes.seen.mockClear();
  mockSettings = { showPatchNotes: true };
  mockState = { seen: CURRENT };
  render(<PatchNotes />);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(IpcSender.patchNotes.seen).not.toHaveBeenCalled();
});

test("Settings opens the history without recording anything", () => {
  mockState = { seen: CURRENT };
  render(<PatchNotes />);
  act(() => window.dispatchEvent(new Event(OPEN_PATCH_NOTES)));
  const dialog = screen.getByRole("dialog");
  expect(dialog).toHaveTextContent("업데이트 내역");
  expect(dialog).toHaveTextContent("현재");
  fireEvent.click(screen.getByText("닫기"));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(IpcSender.patchNotes.seen).not.toHaveBeenCalled();
});
