import React, { useEffect } from "react";
import "./UpdateChecker.scss";
import IpcSender from "../utils/IpcSender";
import { shortenSize } from "../utils/Common";
import { CircularProgress } from "react-cssfx-loading";

const STATE_LABEL = {
  initial: `업데이트 확인 중...`,
  downloading: `업데이트 다운로드 중...`,
  done: `다운로드를 완료했어요`,
  skip: `Thread를 시작하고 있어요`,
  "initial-remove": `이전 설치 파일 정리 중…`,
  mounting: `설치 패키지 준비 중…`,
  copying: `응용 프로그램에 복사 중…`,
  removing: `설치를 마무리하고 있어요`,
};

const UpdateChecker = () => {
  const [state, setState] = React.useState("initial");
  const [current, setCurrent] = React.useState(null);
  const [failure, setFailure] = React.useState(null);

  const label = STATE_LABEL[state] || "업데이트를 준비하고 있어요";
  const percentage = Number.isFinite(current?.percentage) ? Math.min(100, Math.max(0, current.percentage)) : 0;

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
      <div className="content-wrapper" aria-hidden={failure ? true : undefined}>
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
        <div className="text" role="status">{label}</div>
        {current && (
          <>
            <div className="percentage">{percentage.toFixed(2)}%</div>
            <div
              className="loading-bar"
              role="progressbar" aria-label="업데이트 다운로드" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentage}
              style={{ visibility: current ? "visible" : "hidden" }}
            >
              <div
                className="filler"
                style={{ width: `${percentage}%` }}
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
        <div className="update-warning" role="dialog" aria-modal="true" aria-labelledby="update-warning-title" aria-describedby="update-warning-message">
          <div className="update-warning__card">
            <div className="update-warning__icon" aria-hidden="true">!</div>
            <div className="update-warning__title" id="update-warning-title">{failure.title || "업데이트를 확인하지 못했어요"}</div>
            <div className="update-warning__message" id="update-warning-message">{failure.message || "연결 상태를 확인해주세요. 현재 설치된 버전으로 계속할 수 있습니다."}</div>
            <button type="button" autoFocus onClick={continueWithoutUpdate}>
              계속
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default UpdateChecker;
