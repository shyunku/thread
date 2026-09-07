import { act, fireEvent, render, screen } from "@testing-library/react";
import ReleaseAlert from "./ReleaseAlert";
import IpcSender from "../utils/IpcSender";
let mockReceive;
jest.mock("../utils/IpcSender", () => ({
  onAll: jest.fn((topic, receive) => {
    mockReceive = receive;
    return receive;
  }),
  off: jest.fn(),
  releaseAlerts: {
    get: jest.fn((cb) => cb({ success: true, data: null })),
    download: jest.fn(),
    showFile: jest.fn(),
  },
}));
test("works without login context and suppresses a dismissed optional version", () => {
  const { unmount } = render(<ReleaseAlert />);
  mockReceive = IpcSender.onAll.mock.calls[0][1];
  const data = { version: "2.0.0", mandatory: false, status: "available" };
  act(() => mockReceive({ success: true, data }));
  fireEvent.click(screen.getByText("나중에"));
  act(() => mockReceive({ success: true, data }));
  expect(screen.queryByRole("alertdialog")).toBeNull();
  act(() =>
    mockReceive({
      success: true,
      data: { ...data, mandatory: true, status: "ready" },
    })
  );
  expect(screen.getByRole("alertdialog")).toHaveTextContent("필수 업데이트");
  expect(screen.queryByText("나중에")).toBeNull();
  fireEvent.click(screen.getByText("설치 파일 위치 열기"));
  expect(IpcSender.releaseAlerts.showFile).toHaveBeenCalled();
  unmount();
  expect(IpcSender.off).toHaveBeenCalled();
});
