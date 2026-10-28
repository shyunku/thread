// A one-time line for the login screen after the account went away (#92). Kept in memory
// only: set right before the app leaves for /login, read by the login page.
//  - "deleted": deleted on this PC (계정을 삭제했어요)
//  - "deletedElsewhere": deleted on another device (계정이 삭제됐어요)
let pending = null;

export const LOGIN_NOTICES = {
  deleted: {
    title: "계정을 삭제했어요",
    text: "계정과 모든 기기의 데이터를 지웠어요. 그동안 Thread를 써 주셔서 고마워요.",
  },
  deletedElsewhere: {
    title: "계정이 삭제됐어요",
    text: "다른 기기에서 계정을 삭제해서 이 PC의 데이터도 지웠어요.",
  },
};

export function setLoginNotice(kind) {
  pending = LOGIN_NOTICES[kind] ? kind : null;
}

export function peekLoginNotice() {
  return pending;
}

export function clearLoginNotice() {
  pending = null;
}
