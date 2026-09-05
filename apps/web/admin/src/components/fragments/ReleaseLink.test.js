import { act, fireEvent, render, screen } from "@testing-library/react";
import ReleaseLink, { getReleaseLink } from "./ReleaseLink";

test("release URL uses configured domain and encodes query fields", () => {
  expect(getReleaseLink("https://rms.threadapp.kr/", "1.0.3+test", "win"))
    .toBe("https://rms.threadapp.kr/default/release?version=1.0.3%2Btest&category=win");
});

test("copy notice disappears after three seconds and timer is cleared on unmount", async () => {
  jest.useFakeTimers();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: jest.fn().mockResolvedValue() },
  });
  const { unmount } = render(<ReleaseLink version="1.0.4" category="win" />);
  const copy = async () => {
    fireEvent.click(screen.getByRole("button", { name: "win 다운로드 옵션" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "링크 복사" }));
    });
  };
  try {
    await copy();
    act(() => jest.advanceTimersByTime(2999));
    expect(screen.queryByRole("status")).not.toBeNull();
    act(() => jest.advanceTimersByTime(1));
    expect(screen.queryByRole("status")).toBeNull();
    await copy();
    act(() => jest.advanceTimersByTime(2000));
    await copy();
    act(() => jest.advanceTimersByTime(1000));
    expect(screen.queryByRole("status")).not.toBeNull();
    const clearTimer = jest.spyOn(global, "clearTimeout");
    unmount();
    expect(clearTimer).toHaveBeenCalled();
    clearTimer.mockRestore();
  } finally {
    unmount();
    jest.useRealTimers();
  }
});

test("platform button offers download and clipboard actions", async () => {
  process.env.REACT_APP_RMS_ENTRY = "https://rms.threadapp.kr";
  const copy = jest.fn().mockResolvedValue();
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: copy } });
  render(<ReleaseLink version="1.0.3" category="win" />);
  fireEvent.click(screen.getByRole("button", { name: "win 다운로드 옵션" }));
  const link = "https://rms.threadapp.kr/default/release?version=1.0.3&category=win";
  expect(screen.getByRole("link", { name: "다운로드" }).getAttribute("href")).toBe(link);
  fireEvent.click(screen.getByRole("button", { name: "링크 복사" }));
  await screen.findByText("링크가 복사되었습니다.");
  expect(copy).toHaveBeenCalledWith(link);
});
