import TopBar from "components/TopBar";
import SyncWarning from "components/SyncWarning";
import ApplicationGate from "components/ApplicationGate";
import PatchNotes from "components/PatchNotes";
import { TooltipLayer } from "components/Tooltip";
import Loading from "molecules/Loading";
import Toast from "molecules/Toast";
import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Outlet, useNavigate, useOutletContext } from "react-router-dom";
import {
  accountAuthSlice,
  accountInfoSlice,
  setAccount,
} from "store/accountSlice";
import IpcSender from "utils/IpcSender";
import "./Root.layout.scss";
import * as uuid from "uuid";
import { colorize } from "../utils/Common";
import { fromSyncV2View } from "../utils/syncV2View";

const RootLayout = ({ applicationMode }) => {
  const context = useOutletContext();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const accountInfo = useSelector(accountInfoSlice);
  const accountAuth = useSelector(accountAuthSlice);
  const accessToken = accountAuth?.accessToken;
  const refreshToken = accountAuth?.refreshToken;
  const isAuthorized = useMemo(() => {
    return context?.isAuthorized ?? false;
  }, [context]);

  // console.log(accountInfo, accountAuth);

  const [databaseReady, setDatabaseReady] = useState(false);
  const [syncV2, setSyncV2] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");

  const [promises, setPromises] = useState({});
  const [executing, setExecuting] = useState(false);
  const [promiseCounter, setPromiseCounter] = useState(0);

  const emptyState = useMemo(() => {
    return {
      taskMap: {},
      categories: {},
    };
  }, []);

  const [states, setStates] = useState(emptyState);

  const tryAtOffline = useMemo(() => !syncV2?.ready, [syncV2]);

  const addPromise = useCallback((promise) => {
    setPromiseCounter((pc) => {
      setPromises((prev) => {
        const promiseUuid = pc;
        let newPromises = { ...prev, [promiseUuid]: promise };
        // console.log(`--> added promise ${promiseUuid}`);
        return newPromises;
      });
      return pc + 1;
    });
  }, []);

  const executePromises = useCallback(async () => {
    const promiseLength = Object.keys(promises).length;
    if (promiseLength === 0 || executing) return;

    setExecuting(true);
    // Pop the oldest promise synchronously and run it outside the state updater. The
    // updater used to be async, which stored a Promise as the queue and dropped newer
    // entries in a burst (a newer list could be lost, #98).
    const poppedPromiseKey = Object.keys(promises)[0];
    const promise = promises[poppedPromiseKey];
    setPromises((ps) => {
      const copied = { ...ps };
      delete copied[poppedPromiseKey];
      return copied;
    });

    try {
      const transition = await promise(states);
      console.log(colorize.blue(`[Execute promise ${poppedPromiseKey}]`));
      setStates((prev) => {
        if (transition == null) return emptyState;
        const copied = { ...prev };
        for (let key in transition) {
          copied[key] = { ...transition[key] };
        }
        return copied;
      });
    } catch (err) {
      console.error(err);
    }
    setExecuting(false);
  }, [promises, executing, states, emptyState]);

  // TODO :: fix infinite loop (when promises appended while executing,
  //       it will be executed again and again with old states)
  useEffect(() => {
    if (Object.keys(promises).length > 0 && !executing) {
      executePromises();
    }
  }, [promises, executing, states, executePromises]);

  const goBackToLoginPage = () => {
    navigate("/login");
  };

  const trySocketConnection = async () => {
    const userId = accountInfo.uid;
    const connectSocketPromise = new Promise((resolve, reject) => {
      try {
        let timeout = setTimeout(() => {
          reject(new Error("CONNECTION_TIMEOUT"));
        }, applicationMode === "E2EE" ? 30000 : 3000);

        IpcSender.req.socket.tryConnect(
          userId,
          accessToken,
          refreshToken,
          ({ success, data }) => {
            if (success) {
              resolve();
            } else {
              reject(data);
            }
            clearTimeout(timeout);
          }
        );
      } catch (err) {
        reject(err);
      }
    });

    try {
      await Loading.float(
        "서버 연결 중입니다. 잠시만 기다려주세요...",
        connectSocketPromise
      );
    } catch (err) {
      switch (err?.code ?? err?.message) {
        case "401":
        case "UNAUTHORIZED":
          Toast.warn("인증 정보가 만료되었습니다. 다시 로그인해주세요.");
          goBackToLoginPage();
          break;
        // Deleted on another device (#92): AuthRouter handles "auth/accountDeleted".
        case "ACCOUNT_DELETED":
          break;
        default:
          console.log(err);
          Toast.warn(applicationMode === "E2EE"
            ? "동기화가 지연되고 있습니다. 이 기기의 데이터는 유지되며 자동으로 다시 시도합니다."
            : "서버가 연결되지 않았습니다. 편집이 불가능합니다.");
          break;
      }
    }
  };

  useEffect(() => {
    const userId = accountInfo.uid;
    (async () => {
      const checkDatabasePromise = new Promise((resolve, reject) => {
        IpcSender.req.auth.isDatabaseReady(
          userId,
          ({ success }) => {
            if (!success) {
              reject("데이터베이스 접근에 실패했습니다.");
              return;
            }
            // ready for database
            resolve();
          }
        );
      });

      try {
        await Loading.float(
          "데이터베이스 접근 중입니다. 잠시만 기다려주세요...",
          checkDatabasePromise
        );
        setDatabaseReady(true);
        if (isAuthorized) {
          await trySocketConnection();
        } else {
          Toast.info(
            "현재 로컬 계정으로 접속 중입니다. 서버에 접속하려면 로그인해주세요."
          );
        }
      } catch (err) {
        console.error(err);
        Toast.error(
          err?.message ??
            "알 수 없는 오류가 발생했습니다. 로그인 화면으로 이동합니다."
        );
        goBackToLoginPage();
      }
      // The main window stays hidden after unlocking until this point (#106).
      IpcSender.vault.windowReady?.(() => {});
    })();
  }, []);

  useEffect(() => {
    const stateListener = IpcSender.onAll("sync-v2/state", ({ success, data }) => {
      if (success && data.uid === accountInfo.uid) {
        addPromise(async () => fromSyncV2View(data));
      }
    });
    const statusListener = IpcSender.onAll("sync-v2/status", ({ success, data }) => {
      if (success && data.uid === accountInfo.uid) setSyncV2(data);
    });
    return () => {
      IpcSender.off("sync-v2/state", stateListener);
      IpcSender.off("sync-v2/status", statusListener);
    };
  }, [accountInfo.uid, addPromise]);

  useEffect(() => {
    dispatch(setAccount({ offlineMode: tryAtOffline }));
  }, [tryAtOffline]);

  return (
    <div className="root-layout">
      <TopBar searchQuery={searchQuery} setSearchQuery={setSearchQuery} />
      <SyncWarning status={syncV2} />
      {/* Only over the main window once it is open, never the startup update checker (#99). */}
      {databaseReady && <PatchNotes />}
      <div className="root-layout__content">
        {databaseReady ? (
          <Outlet context={{ addPromise, states, searchQuery, syncStatus: syncV2 }} />
        ) : (
          <div
            style={{
              display: "flex",
              width: "100%",
              height: "100%",
              justifyContent: "center",
              alignItems: "center",
            }}
          >
            데이터베이스에 연결 중입니다. 잠시만 기다려주세요...
          </div>
        )}
      </div>
    </div>
  );
};

export default function GuardedRootLayout(){
 const account=useSelector(accountInfoSlice);
 // The tooltip layer sits above the gate so its title bar (update button) gets the same tips.
 return <><TooltipLayer/><ApplicationGate key={account.uid} uid={account.uid}>{mode=><RootLayout applicationMode={mode}/>}</ApplicationGate></>;
}
