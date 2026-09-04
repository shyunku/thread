import React, { useEffect } from "react";
import "./UpdateChecker.scss";
import IpcSender from "../utils/IpcSender";
import { shortenSize } from "../utils/Common";
import { CircularProgress } from "react-cssfx-loading";

const STATE_LABEL = {
  initial: `업데이트 확인 중...`,
  downloading: `업데이트 다운로드 중...`,
  done: `Download done`,
  skip: `Getting start...`,
  "initial-remove": `Removing old files...`,
  mounting: `Mounting packages...`,
  copying: `Copying to Applications...`,
  removing: `Finalizing...`,
};

const UpdateChecker = () => {
  const [state, setState] = React.useState("initial");
  const [current, setCurrent] = React.useState(null);
  const [failure, setFailure] = React.useState(null);

  const label = STATE_LABEL[state];

  useEffect(() => {
    IpcSender.onAll("release_download@initial", (data) => {
      console.log(data);
    });

    IpcSender.onAll("release_download@state", ({ data }) => {
      setState("downloading");
      setCurrent(data);
    });

    IpcSender.onAll("release_download@done", (data) => {
      setState("done");
      setCurrent(null);
    });

    IpcSender.onAll("release_download@skip", (data) => {
      setState("skip");
    });

    IpcSender.onAll("release_install@state", ({ success, data: msg }) => {
      setState(msg);
      setCurrent(null);
    });

    IpcSender.onAll("update_check@failed", ({ data }) => {
      setFailure(data);
    });

    return () => {
      IpcSender.offAll("release_download@initial");
      IpcSender.offAll("release_download@state");
      IpcSender.offAll("release_download@done");
      IpcSender.offAll("release_download@skip");
      IpcSender.offAll("release_install@state");
      IpcSender.offAll("update_check@failed");
    };
  }, []);

  const continueWithoutUpdate = () => {
    IpcSender.silentSender("update_check@continue", true);
  };

  return (
    <div className="updater">
      <div className="content-wrapper">
        <div className="name">Thread</div>
        <div className="loading">
          <CircularProgress
            color="rgb(73, 168, 255)"
            width="38px"
            height="38px"
            duration="0.8s"
            aria-label="업데이트 확인 중"
          />
        </div>
        <div className="text">{label}</div>
        {current && (
          <>
            <div className="percentage">{current?.percentage?.toFixed(2)}%</div>
            <div
              className="loading-bar"
              style={{ visibility: current ? "visible" : "hidden" }}
            >
              <div
                className="filler"
                style={{ width: `${current?.percentage ?? 0}%` }}
              ></div>
              <div className="state">
                {shortenSize(current?.transferred, 1)} /{" "}
                {shortenSize(current?.length, 1)}
              </div>
            </div>
          </>
        )}
      </div>
      {failure && (
        <div className="update-warning" role="dialog" aria-modal="true">
          <div className="update-warning__card">
            <div className="update-warning__icon">!</div>
            <div className="update-warning__title">{failure.title}</div>
            <div className="update-warning__message">{failure.message}</div>
            <button type="button" onClick={continueWithoutUpdate}>
              계속
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default UpdateChecker;
