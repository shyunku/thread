import { fireEvent, render, screen } from "@testing-library/react";
import ReleaseLink, { getReleaseLink } from "./ReleaseLink";

test("release URL uses configured domain and encodes query fields", () => {
  expect(getReleaseLink("https://rms.threadapp.kr/", "1.0.3+test", "win"))
    .toBe("https://rms.threadapp.kr/default/release?version=1.0.3%2Btest&category=win");
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
