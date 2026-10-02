import "./utils/secureLogs";
import React from "react";
import ReactDOM from "react-dom/client";
import { configureStore } from "@reduxjs/toolkit";
import persistStore from "redux-persist/es/persistStore";
import { Provider } from "react-redux";
import { PersistGate } from "redux-persist/integration/react";
import MainRouter from "routers/MainRouter";
import AxiosMiddleware from "middlewares/axios.middleware";
import rootReducer from "store/rootReducer";
import reportWebVitals from "./reportWebVitals";

// Import styles
import "styles/reset.scss";
import "styles/fonts.scss";
import "styles/index.scss";
import Toast from "molecules/Toast";
import Prompt from "molecules/Prompt";
import Loading from "molecules/Loading";
import ModalRouter from "./routers/ModalRouter";
import { isDevMode } from "./utils/Common";
import "styles/surfaces.scss";
import ReleaseAlert from "./components/ReleaseAlert";
import SettingsModal from "./modals/Settings.modal";

if (isDevMode()) {
  window.document.title = "Thread (Dev)";
}

const store = configureStore({
  reducer: rootReducer,
  middleware: (defaultMiddleware) =>
    defaultMiddleware({ serializableCheck: false }),
});

const settingsPreview = process.env.NODE_ENV === "development" &&
  window.location.hash.startsWith("#/__settings-preview");
const previewParams = new URLSearchParams(window.location.hash.split("?")[1] || "");
const previewTab = previewParams.get("tab");
const previewPanel = previewParams.get("panel");
if (settingsPreview) {
  // Dev-only synthetic IPC; this branch is removed from production builds.
  require("./preview/settingsPreviewIpc").installSettingsPreviewIpc(
    require("./utils/IpcSender").default, { recovery: previewParams.get("recovery") || "confirmed", latency: Number(previewParams.get("latency")) || 250 });
}
const persistor = settingsPreview ? null : persistStore(store);
const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(settingsPreview ? (
  <Provider store={store}>
    <SettingsModal id="SETTINGS_PREVIEW" preview previewTab={previewTab} previewPanel={previewPanel} />
  </Provider>
) : (
  <Provider store={store}>
    <PersistGate loading={null} persistor={persistor}>
      <ModalRouter />
      <Prompt.Prompt />
      <Toast.Toaster />
      <Loading.Loading />
      <MainRouter />
      <ReleaseAlert />
      <AxiosMiddleware />
    </PersistGate>
  </Provider>
));

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
