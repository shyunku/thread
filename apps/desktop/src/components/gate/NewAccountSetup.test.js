import { act, fireEvent, render, screen } from "@testing-library/react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import accountReducer, { setAccount } from "../../store/accountSlice";
import IpcSender from "../../utils/IpcSender";
import NewAccountSetup from "./NewAccountSetup";

jest.mock("../../utils/IpcSender", () => ({ req: { auth: { deleteAuthInfoSync: jest.fn() } }, vault: {} }));

const PREVIEW = "THREAD1-F52B8***-" + Array(8).fill("********").join("-");
const calls = [];
const names = () => calls.map(([name]) => name);
const reply = (name, value) => (...args) => {
  const cb = args.pop();
  calls.push([name, ...args]);
  const data = typeof value === "function" ? value(...args) : value;
  if (data === undefined) return; // held: the test answers later
  cb(data instanceof Error ? { success: false, data: { code: data.message } } : { success: true, data });
};
const click = async (name) => { await act(async () => { fireEvent.click(screen.getByRole("button", { name })); }); };
const typeCode = (value) => fireEvent.change(screen.getByPlaceholderText("THREAD1-…"), { target: { value } });

// A fresh account on a fresh device: no local vault yet.
function vault(overrides = {}) {
  let phase = "ABSENT";
  let identity = null;
  IpcSender.vault = {
    status: reply("status", () => ({ uid: "u1", enabled: true, phase, osAvailable: true })),
    create: reply("create", () => { phase = "UNLOCKED"; return { uid: "u1", phase }; }),
    identityStatus: reply("identityStatus", () => identity),
    prepareIdentity: reply("prepareIdentity", () => { identity = { phase: "RECOVERY_UNCONFIRMED", fingerprint: "f" }; return identity; }),
    exportRecovery: reply("exportRecovery", true),
    recoveryCodePreview: reply("recoveryCodePreview", PREVIEW),
    copyRecoveryCode: reply("copyRecoveryCode", true),
    confirmRecovery: reply("confirmRecovery", () => { identity = { ...identity, phase: "RECOVERY_CONFIRMED" }; return identity; }),
    registrationEndpoint: reply("registrationEndpoint", "http://127.0.0.1:4033"),
    registerIdentity: reply("registerIdentity", { phase: "REGISTERED" }),
    activateEmpty: reply("activateEmpty", { phase: "ACTIVE" }),
    ...overrides,
  };
}

async function renderSetup() {
  const store = configureStore({ reducer: { account: accountReducer } });
  store.dispatch(setAccount({ uid: "u1", username: "shyunku" }));
  const onContinue = jest.fn();
  await act(async () => { render(<Provider store={store}><NewAccountSetup uid="u1" onContinue={onContinue} /></Provider>); });
  return { store, onContinue };
}

// Start -> lock -> file -> code -> confirm, ready on the finish step.
async function toFinish() {
  await click("시작하기");
  await click("Windows Hello로 설정");
  await click("파일 저장");
  await click("다음");
  await click("복구 코드 복사");
  await click("적어 뒀어요");
  typeCode("SYNTHETIC-CODE");
  await click("확인");
}

beforeEach(() => { calls.length = 0; });

test("start screen explains the setup and lists the steps for the signed-in account", async () => {
  vault();
  await renderSetup();
  expect(screen.getByRole("heading", { name: "새 데이터 보호 설정" })).toBeInTheDocument();
  expect(screen.getByText("shyunku · 로그인됨")).toBeInTheDocument();
  expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual(["잠금 방법", "복구 파일", "복구 코드", "복구 코드 확인", "시작"]);
  expect(screen.getByRole("button", { name: "시작하기" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "다른 계정으로 로그인" })).toBeInTheDocument();
  // Nothing is created before the user starts.
  expect(names()).toEqual(["status"]);
});

test("steps run in order: lock, file, code, confirm, then one start registers and activates", async () => {
  vault();
  const { onContinue } = await renderSetup();
  await click("시작하기");
  expect(screen.getByRole("heading", { name: "이 기기의 잠금 방법" })).toBeInTheDocument();
  expect(screen.getByText("1/5 · 잠금 방법")).toBeInTheDocument();
  expect(screen.getByText(/나중에 설정에서 바꿀 수 있어요/)).toBeInTheDocument();
  await click("Windows Hello로 설정");
  expect(calls).toContainEqual(["create", { method: "os" }]);
  expect(screen.getByRole("heading", { name: "복구 파일 저장" })).toBeInTheDocument();
  expect(screen.getByText("2/5 · 복구 파일")).toBeInTheDocument();
  await click("파일 저장");
  expect(screen.getByText("복구 파일을 저장했어요")).toBeInTheDocument();
  await click("다음");
  expect(screen.getByRole("heading", { name: "복구 코드 저장" })).toBeInTheDocument();
  expect(screen.getByText(PREVIEW)).toBeInTheDocument();
  await click("복구 코드 복사");
  expect(screen.getByRole("button", { name: "복구 코드 복사" })).toHaveTextContent("복사됨");
  await click("적어 뒀어요");
  expect(screen.getByRole("heading", { name: "복구 코드 확인" })).toBeInTheDocument();
  expect(screen.queryByText(PREVIEW)).not.toBeInTheDocument();
  typeCode("SYNTHETIC-CODE");
  await click("확인");
  expect(calls).toContainEqual(["confirmRecovery", "SYNTHETIC-CODE"]);
  expect(screen.getByRole("heading", { name: "준비 끝" })).toBeInTheDocument();
  expect(screen.getByText("5/5 · 시작")).toBeInTheDocument();
  expect(names()).not.toContain("registerIdentity");
  await click("시작하기");
  expect(names().slice(-3)).toEqual(["registrationEndpoint", "registerIdentity", "activateEmpty"]);
  expect(names().filter((name) => name === "prepareIdentity")).toHaveLength(1);
  expect(onContinue).toHaveBeenCalledTimes(1);
});

test("each recovery step stays closed until its check passes", async () => {
  vault({ exportRecovery: reply("exportRecovery", false), confirmRecovery: reply("confirmRecovery", false) });
  await renderSetup();
  await click("시작하기");
  await click("Windows Hello로 설정");
  expect(screen.getByRole("button", { name: "다음" })).toBeDisabled();
  await click("파일 저장"); // save dialog cancelled
  expect(screen.getByRole("button", { name: "다음" })).toBeDisabled();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  IpcSender.vault.exportRecovery = reply("exportRecovery", true);
  await click("파일 저장");
  await click("다음");
  expect(screen.getByRole("button", { name: "적어 뒀어요" })).toBeDisabled();
  await click("복구 코드 복사");
  await click("적어 뒀어요");
  await click("확인"); // empty code
  expect(screen.getByRole("alert")).toHaveTextContent("복구 코드를 입력해 주세요");
  expect(names()).not.toContain("confirmRecovery");
  typeCode("SYNTHETIC-CODE");
  await click("확인"); // file dialog cancelled
  expect(screen.getByRole("heading", { name: "복구 코드 확인" })).toBeInTheDocument();
  expect(screen.getByPlaceholderText("THREAD1-…")).toHaveValue("");
  IpcSender.vault.confirmRecovery = reply("confirmRecovery", Error("VAULT_ACTION_FAILED"));
  typeCode("WRONG-CODE");
  await click("확인");
  expect(screen.getByRole("alert")).toHaveTextContent("복구 코드나 파일이 맞지 않아요");
  expect(screen.getByRole("heading", { name: "복구 코드 확인" })).toBeInTheDocument();
  expect(names()).not.toContain("registerIdentity");
});

test("a failed start retries activation without registering again", async () => {
  let attempts = 0;
  vault({ activateEmpty: reply("activateEmpty", () => (++attempts === 1 ? Error("VAULT_ACTION_FAILED") : { phase: "ACTIVE" })) });
  const { onContinue } = await renderSetup();
  await toFinish();
  await click("시작하기");
  expect(screen.getByRole("alert")).toHaveTextContent("새 데이터 저장소를 시작하지 못했어요");
  expect(onContinue).not.toHaveBeenCalled();
  await click("시작하기");
  expect(names().filter((name) => name === "registerIdentity")).toHaveLength(1);
  expect(names().filter((name) => name === "activateEmpty")).toHaveLength(2);
  expect(onContinue).toHaveBeenCalledTimes(1);
});

test("an account that already has a vault stops before activation", async () => {
  vault({ registerIdentity: reply("registerIdentity", { phase: "PAIRING_REQUIRED" }) });
  const { onContinue } = await renderSetup();
  await toFinish();
  await click("시작하기");
  expect(screen.getByRole("alert")).toHaveTextContent("이미 연결된 데이터가 있어요");
  expect(names()).not.toContain("activateEmpty");
  expect(onContinue).not.toHaveBeenCalled();
});

test("a second click while starting does not register twice", async () => {
  let answer;
  vault({ registerIdentity: (cb) => { calls.push(["registerIdentity"]); answer = cb; } });
  const { onContinue } = await renderSetup();
  await toFinish();
  const start = screen.getByRole("button", { name: "시작하기" });
  await act(async () => { fireEvent.click(start); fireEvent.click(start); });
  expect(screen.getByRole("button", { name: "시작하는 중…" })).toBeDisabled();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "시작하는 중…" })); });
  await act(async () => { answer({ success: true, data: { phase: "REGISTERED" } }); });
  expect(names().filter((name) => name === "registerIdentity")).toHaveLength(1);
  expect(names().filter((name) => name === "activateEmpty")).toHaveLength(1);
  expect(onContinue).toHaveBeenCalledTimes(1);
});

test("going back keeps the same recovery material and what was already done", async () => {
  vault();
  await renderSetup();
  await click("시작하기");
  await click("Windows Hello로 설정");
  await click("파일 저장");
  await click("다음");
  await click("복구 코드 복사");
  await click("이전");
  expect(screen.getByText("복구 파일을 저장했어요")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "다음" })).toBeEnabled();
  await click("이전");
  expect(screen.getByRole("heading", { name: "새 데이터 보호 설정" })).toBeInTheDocument();
  await click("이어서 하기"); // the lock exists: back to the file step, not the lock step
  expect(screen.getByRole("heading", { name: "복구 파일 저장" })).toBeInTheDocument();
  await click("다음");
  expect(screen.getByRole("button", { name: "적어 뒀어요" })).toBeEnabled();
  expect(names().filter((name) => name === "prepareIdentity")).toHaveLength(1);
  expect(names().filter((name) => name === "create")).toHaveLength(1);
  expect(names().filter((name) => name === "exportRecovery")).toHaveLength(1);
});

test("a setup closed after the recovery check resumes at the start step", async () => {
  vault({
    status: reply("status", { uid: "u1", enabled: true, phase: "UNLOCKED", osAvailable: true }),
    identityStatus: reply("identityStatus", { phase: "RECOVERY_CONFIRMED", fingerprint: "f" }),
  });
  await renderSetup();
  await click("이어서 하기");
  expect(screen.getByRole("heading", { name: "준비 끝" })).toBeInTheDocument();
  await click("이전");
  expect(screen.getByText("복구 코드와 파일을 확인했어요.")).toBeInTheDocument();
  expect(names()).not.toContain("prepareIdentity");
  expect(names()).not.toContain("create");
});

test("an unreadable device state keeps setup closed", async () => {
  vault({ status: reply("status", Error("VAULT_ACTION_FAILED")) });
  await renderSetup();
  expect(screen.getByRole("button", { name: "시작하기" })).toBeDisabled();
  expect(screen.getByText(/상태를 확인하지 못했어요/)).toBeInTheDocument();
});

test("signing in with another account clears this device's login", async () => {
  vault();
  IpcSender.req.auth.deleteAuthInfoSync.mockResolvedValue(true);
  const { store } = await renderSetup();
  await click("다른 계정으로 로그인");
  expect(IpcSender.req.auth.deleteAuthInfoSync).toHaveBeenCalledWith("u1");
  expect(store.getState().account.account.uid).toBeFalsy();
});

test("a recovery code that fails to load shows an error and can be loaded again", async () => {
  let attempts = 0;
  vault({ recoveryCodePreview: reply("recoveryCodePreview", () => (++attempts === 1 ? Error("RECOVERY_REFRESH_REQUIRED") : PREVIEW)) });
  await renderSetup();
  await click("시작하기");
  await click("Windows Hello로 설정");
  await click("파일 저장");
  await click("다음");
  expect(screen.getByRole("alert")).toHaveTextContent("복구 코드를 불러오지 못했어요");
  expect(screen.getByRole("button", { name: "복구 코드 복사" })).toBeDisabled();
  await click("다시 시도");
  expect(screen.getByText(PREVIEW)).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  await click("복구 코드 복사");
  expect(screen.getByRole("button", { name: "적어 뒀어요" })).toBeEnabled();
});

test("right after the lock is made, going back resumes at the file step without reading status again", async () => {
  let reads = 0;
  vault();
  const status = IpcSender.vault.status;
  IpcSender.vault.status = (cb) => (++reads === 1 ? status(cb) : calls.push(["status"])); // later reads never answer
  await renderSetup();
  await click("시작하기");
  await click("Windows Hello로 설정");
  expect(screen.getByRole("heading", { name: "복구 파일 저장" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "파일 저장" })).toBeEnabled();
  await click("이전");
  const items = screen.getAllByRole("listitem");
  expect(items[0]).toHaveClass("done");
  expect(items[1]).toHaveClass("here");
  expect(screen.getByRole("button", { name: "이어서 하기" })).toBeEnabled();
  await click("이어서 하기");
  expect(screen.getByRole("heading", { name: "복구 파일 저장" })).toBeInTheDocument();
  expect(names().filter((name) => name === "create")).toHaveLength(1);
});

test("an unreadable status after the lock offers a retry on the file step", async () => {
  let reads = 0;
  const answers = [{ uid: "u1", enabled: true, phase: "ABSENT", osAvailable: true }, Error("VAULT_ACTION_FAILED"), { uid: "u1", enabled: true, phase: "UNLOCKED", osAvailable: true }];
  // create answers nothing here, so the file step has to read status itself; that read fails once.
  vault({ create: reply("create", null), status: reply("status", () => answers[Math.min(reads++, 2)]) });
  await renderSetup();
  await click("시작하기");
  await click("Windows Hello로 설정");
  expect(screen.getByRole("heading", { name: "복구 파일 저장" })).toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("복구 자료를 준비하지 못했어요");
  await click("다시 시도");
  expect(screen.getByRole("button", { name: "파일 저장" })).toBeEnabled();
  expect(names().filter((name) => name === "status")).toHaveLength(3);
  expect(names().filter((name) => name === "prepareIdentity")).toHaveLength(1);
});

test("Enter submits the recovery code and the lock password", async () => {
  vault();
  await renderSetup();
  await click("시작하기");
  await act(async () => { fireEvent.click(screen.getByRole("radio", { name: /비밀번호/ })); });
  fireEvent.change(document.getElementById("gate-lock-password"), { target: { value: "synthetic-pass-12" } });
  fireEvent.change(document.getElementById("gate-lock-confirm"), { target: { value: "synthetic-pass-12" } });
  await act(async () => { fireEvent.submit(document.getElementById("gate-lock-password").form); });
  expect(calls).toContainEqual(["create", "synthetic-pass-12"]);
  await click("파일 저장");
  await click("다음");
  await click("복구 코드 복사");
  await click("적어 뒀어요");
  const input = screen.getByPlaceholderText("THREAD1-…");
  expect(input).toHaveFocus();
  typeCode("SYNTHETIC-CODE");
  await act(async () => { fireEvent.submit(input.form); });
  expect(calls).toContainEqual(["confirmRecovery", "SYNTHETIC-CODE"]);
  expect(screen.getByRole("heading", { name: "준비 끝" })).toBeInTheDocument();
});
