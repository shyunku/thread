import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { fireEvent, render, screen } from "@testing-library/react";
import accountReducer from "../store/accountSlice";
import SettingsModal from "./Settings.modal";

test("settings preview keeps all five sections and their controls", () => {
  const store = configureStore({ reducer: { account: accountReducer } });
  render(<Provider store={store}><SettingsModal id="SETTINGS_PREVIEW" preview previewTab="data" /></Provider>);

  const navigation = screen.getByRole("navigation", { name: "설정 메뉴" });
  expect(navigation.querySelectorAll("button")).toHaveLength(5);
  expect(screen.getByRole("heading", { name: "데이터" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "다시 동기화" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "관리 메뉴 열기" }));
  expect(screen.getByRole("navigation", { name: "보관함 작업" }).querySelectorAll("button")).toHaveLength(8);
  fireEvent.click(screen.getByRole("button", { name: "계정" }));
  expect(screen.getByRole("button", { name: "로그아웃" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "정보" }));
  expect(screen.getByText("버전")).toBeInTheDocument();
});

test("normal settings retain the account action", () => {
  const store = configureStore({ reducer: { account: accountReducer } });
  render(<Provider store={store}><SettingsModal id="SETTINGS" active /></Provider>);
  fireEvent.click(screen.getByRole("button", { name: "계정" }));
  expect(screen.getByRole("button", { name: "로그아웃" })).toBeEnabled();
});
