import { act, fireEvent, render, screen } from "@testing-library/react";
import LockScreen from "./LockScreen";

test("OS authentication is the primary action and password opens on request", async () => {
  const onOS = jest.fn(async () => true), onPassword = jest.fn(async () => true);
  render(<LockScreen osAvailable passwordAvailable onOSUnlock={onOS} onPasswordUnlock={onPassword} />);
  expect(screen.getByRole("heading", { name: "Thread가 잠겼어요" })).toBeInTheDocument();
  expect(screen.queryByLabelText("비밀번호", { selector: "input" })).not.toBeInTheDocument();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Windows Hello로 열기" })); });
  expect(onOS).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "비밀번호로 열기" }));
  const input = screen.getByPlaceholderText("비밀번호");
  fireEvent.change(input, { target: { value: "secret" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "열기" })); });
  expect(onPassword).toHaveBeenCalledWith("secret");
  expect(input.value).toBe("");
});

test("failures explain briefly and the password path is the default without OS authentication", async () => {
  const onOS = jest.fn(async () => { throw Error("AUTH_CANCELLED"); });
  const { unmount } = render(<LockScreen osAvailable passwordAvailable onOSUnlock={onOS} onPasswordUnlock={jest.fn()} />);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Windows Hello로 열기" })); });
  expect(screen.getByRole("alert")).toHaveTextContent("본인 확인이 취소됐어요. 비밀번호로도 열 수 있어요.");
  unmount();
  render(<LockScreen osAvailable={false} passwordAvailable onPasswordUnlock={jest.fn(async () => false)} />);
  expect(screen.queryByRole("button", { name: "비밀번호로 열기" })).not.toBeInTheDocument();
  fireEvent.change(screen.getByPlaceholderText("비밀번호"), { target: { value: "wrong" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "열기" })); });
  expect(screen.getByRole("alert")).toHaveTextContent("비밀번호가 맞지 않아요.");
});

test("no available method points to recovery", () => {
  render(<LockScreen osAvailable={false} passwordAvailable={false} />);
  expect(screen.getByRole("alert")).toHaveTextContent("복구가 필요해요");
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
