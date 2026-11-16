import { act, fireEvent, render, screen } from "@testing-library/react";
import LockScreen from "./LockScreen";

test("OS authentication is the primary action and password opens on request", async () => {
  const onOS = jest.fn(async () => true), onPassword = jest.fn(async () => true);
  render(<LockScreen osAvailable passwordAvailable onOSUnlock={onOS} onPasswordUnlock={onPassword} />);
  expect(screen.getByRole("heading", { name: "Thread가 잠겼어요" })).toBeInTheDocument();
  expect(screen.queryByLabelText("비밀번호", { selector: "input" })).not.toBeInTheDocument();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Windows Hello로 열기" })); });
  expect(onOS).toHaveBeenCalledTimes(1);
  expect(onOS).toHaveBeenCalledWith(false);
  fireEvent.click(screen.getByRole("button", { name: "비밀번호로 열기" }));
  const input = screen.getByPlaceholderText("비밀번호");
  fireEvent.change(input, { target: { value: "secret" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "열기" })); });
  expect(onPassword).toHaveBeenCalledWith("secret", false);
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

test("이 PC에서 다시 묻지 않기: a small check under the button, passed with the unlock (#111)", async () => {
  const onOS = jest.fn(async () => true), onPassword = jest.fn(async () => true);
  const { container } = render(<LockScreen osAvailable passwordAvailable onOSUnlock={onOS} onPasswordUnlock={onPassword} />);
  const check = screen.getByRole("checkbox", { name: "이 PC에서 다시 묻지 않기" });
  expect(check).toHaveAttribute("aria-checked", "false");
  // Under the unlock button, above 비밀번호로 열기.
  const order = [...container.querySelectorAll("button")].map((b) => b.textContent);
  expect(order).toEqual(["Windows Hello로 열기", "이 PC에서 다시 묻지 않기", "비밀번호로 열기"]);
  fireEvent.click(check);
  expect(check).toHaveAttribute("aria-checked", "true");
  expect(check).toHaveClass("on");
  expect(check.querySelector(".lock-screen__box svg")).not.toBeNull();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Windows Hello로 열기" })); });
  expect(onOS).toHaveBeenCalledWith(true);
  // The password way passes it too.
  fireEvent.click(screen.getByRole("button", { name: "비밀번호로 열기" }));
  fireEvent.change(screen.getByPlaceholderText("비밀번호"), { target: { value: "secret" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "열기" })); });
  expect(onPassword).toHaveBeenCalledWith("secret", true);
  fireEvent.click(check);
  expect(check).toHaveAttribute("aria-checked", "false");
});

test("no check when nothing can open the vault", () => {
  render(<LockScreen osAvailable={false} passwordAvailable={false} />);
  expect(screen.queryByRole("checkbox")).toBeNull();
});
