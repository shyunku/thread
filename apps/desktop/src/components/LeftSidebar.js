import {
  ContextMenu,
  Seperator,
  useContextMenu,
} from "molecules/CustomContextMenu";
import Prompt from "molecules/Prompt";
import SubmitInput from "molecules/SubmitInput";
import Toast from "molecules/Toast";
import Category from "objects/Category";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  IoAdd,
  IoClose,
  IoKey,
  IoKeySharp,
  IoLogoBuffer,
  IoReader,
  IoStar,
  IoToday,
  IoSettingsOutline,
} from "react-icons/io5";
import { useSelector } from "react-redux";
import { useOutletContext } from "react-router-dom";
import { accountInfoSlice } from "store/accountSlice";
import { printf } from "utils/Common";
import { sortCategories } from "utils/categoryOrder";
import IpcSender from "utils/IpcSender";
import JsxUtil from "utils/JsxUtil";
import "./LeftSidebar.scss";
import ProfileImage from "./ProfileImage";
import {
  applyCreateCategory,
  applyDeleteCategory,
} from "../hooks/UseTransaction";
import moment from "moment";
import Clock from "./Clock";
import { openModal } from "../molecules/Modal";
import { MODAL_TYPES } from "../routers/ModalRouter";

const activateWithKeyboard = (event) => {
  if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault();
    event.currentTarget.click();
  }
};

export const TODO_MENU_TYPE = {
  ALL: "모든 할일",
  TODAY: "오늘의 할일",
  IMPORTANT: "중요한 할일",
};

export const TODO_MENU_TYPE_TO_ICON = {
  [TODO_MENU_TYPE.ALL]: <IoLogoBuffer />,
  [TODO_MENU_TYPE.TODAY]: <IoToday />,
  [TODO_MENU_TYPE.IMPORTANT]: <IoStar style={{ color: "#f2c14e" }} />,
};

const TODO_MENU_TYPE_TO_LABEL = {
  [TODO_MENU_TYPE.ALL]: "모든 할 일",
  [TODO_MENU_TYPE.TODAY]: "오늘",
  [TODO_MENU_TYPE.IMPORTANT]: "중요",
};

const LeftSidebar = ({
  setSelectedTodoMenuType,
  selectedTodoMenuType,
  hideLeftSidebar,
}) => {
  const context = useOutletContext();
  const { localNonce, remoteNonce, addPromise, states } = context;
  const { categories, taskMap } = states;

  const accountInfo = useSelector(accountInfoSlice);
  const offlineMode = accountInfo?.offlineMode ?? false;
  const username =
    accountInfo?.username ??
    accountInfo?.googleEmail ??
    accountInfo?.uid ??
    "Unknown";
  const profileImageUrl =
    (offlineMode
      ? accountInfo?.profileImageUrl
      : accountInfo?.googleProfileImageUrl) ?? null;

  const [syncStatus, syncText] = useMemo(() => {
    if (offlineMode) return ["offline", "오프라인 (편집 불가)"];
    if (remoteNonce == null) return ["synchronizing", "동기화 중"];
    if (localNonce === remoteNonce) return ["synchronized", "동기화 완료"];
    return ["synchronizing", `동기화 중 - ${localNonce} / ${remoteNonce}`];
  }, [offlineMode, localNonce, remoteNonce]);

  // The synced user order (sort_rank), the same as mobile.
  const sortedCategories = useMemo(
    () => sortCategories(Object.values(categories)),
    [categories]
  );

  const undoneTaskCountMap = useMemo(() => {
    const cntMap = {};
    let totalUndone = 0,
      todayUndone = 0,
      importantUndone = 0;
    for (const category of sortedCategories) {
      cntMap[category.id] = 0;
    }
    for (const tid in taskMap) {
      const task = taskMap[tid];
      if (!task.done) {
        for (const cid in task.categories) {
          if (cntMap[cid] == null) {
            cntMap[cid] = 0;
            console.warn(`Task ${tid} has invalid category ${cid}`);
          }
          cntMap[cid] += 1;
        }
        totalUndone++;
        if (
          task.dueDate != null &&
          moment(task.dueDate).isSame(moment(), "day")
        )
          todayUndone++;
        if (task.important === true) importantUndone++;
      }
    }
    cntMap[TODO_MENU_TYPE.ALL] = totalUndone;
    cntMap[TODO_MENU_TYPE.TODAY] = todayUndone;
    cntMap[TODO_MENU_TYPE.IMPORTANT] = importantUndone;
    return cntMap;
  }, [sortedCategories, taskMap]);

  const createCategoryCxt = useContextMenu({ clearInputsOnBlur: true });
  const addSecretCategoryCxt = useContextMenu({ clearInputsOnBlur: true });

  const tryAddCategory = (categoryName) => {
    const category = new Category(categoryName, false);
    IpcSender.req.category.createCategory(category.toEntity(), null);
    createCategoryCxt.closer();
  };

  const tryAddSecretCategory = (categoryName) => {
    const category = new Category(categoryName, true);
    IpcSender.req.category.createCategory(category.toEntity(), null);
    addSecretCategoryCxt.closer();
  };

  const tryDeleteCategory = (e, categoryId) => {
    e.stopPropagation();
    IpcSender.req.category.getCategoryTasks(categoryId, ({ success, data }) => {
      if (success) {
        if (data.length > 0) {
          Toast.warn(
            `${data.length}개의 항목에서 해당 카테고리를 사용중입니다.`
          );
          return;
        }

        IpcSender.req.category.deleteCategory(categoryId, null);
      }
    });
  };

  const onCustomCategorySelect = (e, categoryId) => {
    e.stopPropagation();
    const category = categories[categoryId];
    if (category) {
      if (category.secret == true) {
        // Secret categories open the way the vault opens (#102): OS auth when the vault
        // uses it, otherwise the vault password. The session-wide unlock comes in the
        // sidebar redesign; this keeps the category usable until then.
        const open = () => setSelectedTodoMenuType(categoryId);
        IpcSender.vault.verifyUser({}, ({ success, data } = {}) => {
          if (!success) return Toast.error("잠금을 풀 수 없습니다.");
          if (data?.verified) return open();
          if (data?.method !== "password" || data.code !== "PASSWORD_REJECTED") {
            if (data?.code !== "OS_AUTH_CANCELLED") Toast.error("잠금을 풀 수 없습니다.");
            return;
          }
          Prompt.float(
            "비밀 카테고리",
            `'${category.title}' 카테고리를 열려면 보관함 비밀번호를 입력해주세요.`,
            {
              inputs: [
                { key: "password", placeholder: "비밀번호", type: "password" },
              ],
              onConfirm: (input) =>
                new Promise((resolve) => {
                  IpcSender.vault.verifyUser(
                    { method: "password", password: input.password },
                    ({ success, data } = {}) => {
                      if (success && data?.verified) {
                        open();
                        return resolve(true);
                      }
                      Toast.error("비밀번호가 일치하지 않습니다.");
                      resolve(false);
                    }
                  );
                }),
            }
          );
        });
      } else {
        setSelectedTodoMenuType(categoryId);
      }
    }
  };

  useEffect(() => {
    IpcSender.onAll("category/createCategory", ({ success, data }) => {
      applyCreateCategory({ success, data, addPromise });
    });

    IpcSender.onAll("category/deleteCategory", ({ success, data }) => {
      applyDeleteCategory({ success, data, addPromise });
    });

    return () => {
      IpcSender.offAll("category/createCategory");
      IpcSender.offAll("category/deleteCategory");
    };
  }, [states]);

  return (
    <div
      className={
        "component left-sidebar" +
        JsxUtil.classByCondition(hideLeftSidebar, "hide")
      }
    >
      <Clock />
      <div className="todo-menu-groups">
        <div className="todo-menu-group standard">
          <div className="header">
            <div className="title">내 작업</div>
            <div className="buttons"></div>
          </div>
          <div className="todo-menus">
            {Object.values(TODO_MENU_TYPE).map((menuType) => (
              <div
                key={menuType}
                role="button"
                tabIndex={0}
                aria-pressed={selectedTodoMenuType === menuType}
                onKeyDown={activateWithKeyboard}
                className={`todo-menu default ${
                  selectedTodoMenuType === menuType ? "selected" : ""
                }`}
                onClick={() => setSelectedTodoMenuType(menuType)}
              >
                <div className="icon-wrapper">
                  {TODO_MENU_TYPE_TO_ICON[menuType]}
                </div>
                <div className={"content"}>
                  {/*undoneTaskCountMap*/}
                  <div className="title">{TODO_MENU_TYPE_TO_LABEL[menuType]}</div>
                  <div className={"task-count"}>
                    {" "}
                    {undoneTaskCountMap?.[menuType] ?? "?"}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="todo-menu-group custom">
          <div className="header">
            <div className="title">카테고리</div>
            <div className="buttons">
              <div className="button">
                <div
                  className="visible"
                  role="button" tabIndex={0} aria-label="카테고리 추가" onKeyDown={activateWithKeyboard}
                  ref={createCategoryCxt.openerRef}
                  onClick={createCategoryCxt.opener}
                >
                  <IoAdd />
                </div>
                <ContextMenu
                  className="category-create-menu"
                  defaultStyle={true}
                  sticky={true}
                  reference={createCategoryCxt.ref}
                >
                  <SubmitInput
                    placeholder="새로운 카테고리 생성"
                    onSubmit={tryAddCategory}
                    maxLength={20}
                  />
                </ContextMenu>
              </div>
              <div className="button">
                <div
                  className="visible key"
                  role="button" tabIndex={0} aria-label="보안 카테고리 추가" onKeyDown={activateWithKeyboard}
                  ref={addSecretCategoryCxt.openerRef}
                  onClick={addSecretCategoryCxt.opener}
                >
                  <IoKey />
                </div>
                <ContextMenu
                  className="category-create-menu"
                  defaultStyle={true}
                  sticky={true}
                  reference={addSecretCategoryCxt.ref}
                >
                  <SubmitInput
                    placeholder="새로운 보안 카테고리 생성"
                    maxLength={20}
                    onSubmit={tryAddSecretCategory}
                  />
                </ContextMenu>
              </div>
            </div>
          </div>
          <div className="todo-menus">
            {sortedCategories.map((category) => (
              <div
                className={
                  "todo-menu" +
                  JsxUtil.classByEqual(
                    selectedTodoMenuType,
                    category.id,
                    "selected"
                  )
                }
                key={category.id}
                role="button" tabIndex={0} aria-pressed={selectedTodoMenuType === category.id} onKeyDown={activateWithKeyboard}
                onClick={(e) => onCustomCategorySelect(e, category.id)}
              >
                <div className="icon-wrapper" style={{ color: category.color }}>
                  {category.secret ? <IoKeySharp /> : <span className="category-dot" />}
                </div>
                <div className={"content"}>
                  <div className="title">{category.title}</div>
                  <div className={"task-count"}>
                    {undoneTaskCountMap?.[category.id] ?? "?"}
                  </div>
                </div>
                <div
                  className="delete-btn"
                  role="button" tabIndex={0} aria-label={`${category.title} 카테고리 삭제`} onKeyDown={activateWithKeyboard}
                  onClick={(e) => tryDeleteCategory(e, category.id)}
                >
                  <IoClose />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="account-section">
        <ProfileImage src={profileImageUrl} size={36} />
        <div className="profile-summary">
          <div className="email">{username}</div>
          <div className="account-caption">{accountInfo?.googleEmail || "나의 작업 공간"}</div>
        </div>
        <button className="account-settings" aria-label="환경설정" title="환경설정"
          onClick={() => openModal(MODAL_TYPES.SETTINGS)}><IoSettingsOutline /></button>
      </div>
    </div>
  );
};

export default LeftSidebar;
