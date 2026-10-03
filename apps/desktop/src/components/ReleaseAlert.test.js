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
    install: jest.fn(),
  },
}));
test("optional notice opens on indicator click and required notice cannot be dismissed", () => {
  const { unmount } = render(<ReleaseAlert />);
  mockReceive = IpcSender.onAll.mock.calls[0][1];
  const data = { version: "2.0.0", mandatory: false, status: "available" };
  act(() => mockReceive({ success: true, data }));
  expect(screen.queryByRole("alertdialog")).toBeNull();
  act(() => window.dispatchEvent(new Event("thread:open-update")));
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
  fireEvent.click(screen.getByText("설치 후 재시작"));
  expect(IpcSender.releaseAlerts.install).toHaveBeenCalled();
  unmount();
  expect(IpcSender.off).toHaveBeenCalled();
});

test("tray update check opens the optional notice directly", () => {
  IpcSender.onAll.mockClear();
  render(<ReleaseAlert />);
  const open = IpcSender.onAll.mock.calls.find(([topic]) => topic === "release-alert/open")[1];
  act(() => open({ success: true, data: { version: "2.0.6", mandatory: false, status: "available" } }));
  expect(screen.getByRole("alertdialog")).toHaveTextContent("2.0.6");
  expect(screen.getByText("나중에")).toBeInTheDocument();
});
