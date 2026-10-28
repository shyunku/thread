import { render, screen } from "@testing-library/react";
import App from "./App";
import { latestWindowsRelease } from "./release";

const target = (version, platform = "win", arch = "x64") => ({
  length: 151931277,
  hashes: { sha256: "ab".repeat(32) },
  custom: { thread: { schema: 1, platform, arch, version, mandatory: false } },
});
const METADATA = {
  signed: {
    targets: {
      "releases.json": { length: 10, hashes: { sha256: "00" } },
      "win/x64/2.0.3/installer.exe": target("2.0.3"),
      "win/x64/2.0.10/installer.exe": target("2.0.10"),
      "win/x64/2.1.0-beta.1/installer.exe": target("2.1.0-beta.1"),
      "mac/universal/9.0.0/installer.dmg": target("9.0.0", "mac", "universal"),
    },
  },
};

afterEach(() => { delete global.fetch; });

test("picks the newest stable Windows installer from signed metadata", () => {
  expect(latestWindowsRelease(METADATA)).toMatchObject({
    version: "2.0.10",
    url: "https://rms.threadapp.kr/tuf/targets/win/x64/2.0.10/installer.exe",
  });
  expect(latestWindowsRelease({ signed: { targets: { "win/x64/2.0.3/installer.exe": { ...target("2.0.4") } } } })).toBeNull();
  expect(latestWindowsRelease(null)).toBeNull();
});

test("landing links the download button to the latest installer", async () => {
  global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(METADATA) }));
  render(<App path="/" />);
  const buttons = await screen.findAllByRole("link", { name: /Windows용 다운로드 v2\.0\.10/ });
  expect(buttons[0]).toHaveAttribute("href", "https://rms.threadapp.kr/tuf/targets/win/x64/2.0.10/installer.exe");
  expect(screen.getByText("ab".repeat(32))).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: /Windows의 PC 보호/ })).toBeInTheDocument();
});

test("landing explains when the release list cannot be loaded", async () => {
  global.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 503 }));
  render(<App path="/" />);
  expect(await screen.findByRole("alert")).toHaveTextContent("불러오지 못했어요");
  expect(screen.queryByRole("link", { name: /Windows용 다운로드/ })).toBeNull();
});

test("privacy policy and unknown pages render", () => {
  global.fetch = jest.fn(() => new Promise(() => {}));
  const { unmount } = render(<App path="/privacy/" />);
  expect(screen.getByRole("heading", { level: 1, name: "개인정보처리방침" })).toBeInTheDocument();
  expect(screen.getAllByRole("link", { name: "shyunku.support@gmail.com" }).length).toBeGreaterThan(0);
  unmount();
  render(<App path="/nope" />);
  expect(screen.getByRole("heading", { name: "페이지를 찾을 수 없어요" })).toBeInTheDocument();
});

test("account deletion page explains the app steps, the email request and timing", () => {
  global.fetch = jest.fn(() => new Promise(() => {}));
  const { unmount } = render(<App path="/delete-account" />);
  expect(screen.getByRole("heading", { level: 1, name: "계정 삭제" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: /PC 앱/ })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: /휴대폰 앱/ })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "메일 쓰기" }).getAttribute("href"))
    .toBe("mailto:shyunku.support@gmail.com?subject=" + encodeURIComponent("Thread 계정 삭제 요청"));
  expect(screen.getAllByText("삭제하는 즉시")).toHaveLength(3);
  expect(screen.getByText("30일 안에 사라져요")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "계정 삭제" })).toHaveAttribute("aria-current", "page");
  expect(document.title).toBe("계정 삭제 — Thread");
  unmount();
  // The privacy policy no longer says deletion is impossible in the app and links the page.
  render(<App path="/privacy" />);
  expect(screen.queryByText(/앱 안에서 할 수 없으며/)).toBeNull();
  expect(screen.getByRole("link", { name: "계정 삭제 안내" })).toHaveAttribute("href", "/delete-account");
  expect(screen.getByRole("link", { name: "계정 삭제" })).toHaveAttribute("href", "/delete-account");
});
