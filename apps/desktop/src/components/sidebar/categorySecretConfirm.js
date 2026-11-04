import { objectParticle } from "../../molecules/pickers/deleteConfirm";
import { osAuthName } from "../../hooks/useSecretSession";

// How the lock opens, by the method the vault confirms with (null: not known yet).
const methodName = (method) => (method === "os" ? osAuthName() : method === "password" ? "보관함 비밀번호" : null);

// The question before a category turns secret or normal (#106 mock dialog(), confirmed by the
// user), as ConfirmDialog props. `count` is the number of its tasks the screen may show
// (utils/menuFilters categoryTaskCount); `locked`: the secret lock is closed, so a category
// turned secret is hidden at once. onChoose gets "switch".
export function categorySecretConfirm({ title, secret = false, color }, count, { locked = false, method = null } = {}) {
  const name = `${title ?? ""}${objectParticle(title)}`;
  const what = count > 0 ? `이 카테고리와 그 할 일 ${count}개가` : "이 카테고리가";
  const how = methodName(method);
  const base = { icon: "shield", iconColor: color };
  if (secret) {
    return {
      ...base,
      title: `${name} 일반 카테고리로 바꿀까요?`,
      body: `바꾸면 잠금과 상관없이 ${what} 늘 보여요. 모든 기기에 같이 적용돼요.`,
      choices: [{ id: "switch", label: "일반으로 바꾸기" }],
    };
  }
  const body = locked
    ? `지금은 잠금이 닫혀 있어서 바꾸면 ${what} 바로 숨겨져요. 잠금을 풀면${how ? `(${how})` : ""} 다시 보여요. 모든 기기에 같이 적용돼요.`
    : `잠금이 닫혀 있을 때는 ${what} 숨겨져요. 잠금을 풀 때 ${how ? `${how}로 확인해요` : "본인 확인을 해요"}. 모든 기기에 같이 적용돼요.`;
  return {
    ...base,
    title: `${name} 비밀 카테고리로 바꿀까요?`,
    body,
    choices: [{ id: "switch", label: "비밀로 바꾸기" }],
  };
}
