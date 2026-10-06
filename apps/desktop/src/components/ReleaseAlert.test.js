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
    update: jest.fn(),
    cancel: jest.fn(),
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
  fireEvent.click(screen.getByText("업데이트"));
  expect(IpcSender.releaseAlerts.update).toHaveBeenCalled();
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

test("one button updates: waiting can be cancelled, installing has no buttons, failures retry", () => {
  IpcSender.onAll.mockClear();
  render(<ReleaseAlert />);
  const open = IpcSender.onAll.mock.calls.find(([topic]) => topic === "release-alert/open")[1];
  const show = (data) => act(() => open({ success: true, data: { version: "2.0.10", mandatory: false, ...data } }));
  show({ status: "available" });
  expect(screen.getByRole("alertdialog")).toHaveTextContent("업데이트할 수 있어요");
  fireEvent.click(screen.getByText("업데이트"));
  expect(IpcSender.releaseAlerts.update).toHaveBeenCalledTimes(1);
  show({ status: "downloading", autoInstall: true });
  expect(screen.getByText("업데이트 중…")).toBeDisabled();
  fireEvent.click(screen.getByText("취소"));
  expect(IpcSender.releaseAlerts.cancel).toHaveBeenCalled();
  show({ status: "downloading", autoInstall: false });
  expect(screen.getByText("나중에")).toBeInTheDocument();
  expect(screen.getByText("업데이트")).toBeEnabled();
  show({ status: "installing", autoInstall: true });
  expect(screen.getByRole("alertdialog")).toHaveTextContent("잠시 후 Thread가 다시 열려요.");
  expect(screen.queryByRole("button")).toBeNull();
  show({ status: "ready", installFailed: true });
  expect(screen.getByRole("alertdialog")).toHaveTextContent("업데이트하지 못했어요");
  fireEvent.click(screen.getByText("다시 시도"));
  expect(IpcSender.releaseAlerts.update).toHaveBeenCalledTimes(2);
});
