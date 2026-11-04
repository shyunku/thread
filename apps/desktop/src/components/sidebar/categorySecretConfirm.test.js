import { categorySecretConfirm } from "./categorySecretConfirm";

// #106 mock dialog(): the words of the secret <-> normal question.
test("normal to secret: the title takes 을/를 and the text follows the lock and the method", () => {
  const open = categorySecretConfirm({ title: "할 일 목록", color: "#6294ff" }, 3, { method: "password" });
  expect(open).toEqual({
    icon: "shield",
    iconColor: "#6294ff",
    title: "할 일 목록을 비밀 카테고리로 바꿀까요?",
    body: "잠금이 닫혀 있을 때는 이 카테고리와 그 할 일 3개가 숨겨져요. 잠금을 풀 때 보관함 비밀번호로 확인해요. 모든 기기에 같이 적용돼요.",
    choices: [{ id: "switch", label: "비밀로 바꾸기" }],
  });
  // No task: only the category is named. Method not known yet: no name in the text.
  expect(categorySecretConfirm({ title: "업무" }, 0).body).toBe(
    "잠금이 닫혀 있을 때는 이 카테고리가 숨겨져요. 잠금을 풀 때 본인 확인을 해요. 모든 기기에 같이 적용돼요."
  );
  expect(categorySecretConfirm({ title: "업무" }, 2, { locked: true, method: "os" }).body).toBe(
    "지금은 잠금이 닫혀 있어서 바꾸면 이 카테고리와 그 할 일 2개가 바로 숨겨져요. 잠금을 풀면(Windows Hello) 다시 보여요. 모든 기기에 같이 적용돼요."
  );
  expect(categorySecretConfirm({ title: "업무" }, 0, { locked: true }).body).toBe(
    "지금은 잠금이 닫혀 있어서 바꾸면 이 카테고리가 바로 숨겨져요. 잠금을 풀면 다시 보여요. 모든 기기에 같이 적용돼요."
  );
});

test("secret to normal: no check, one button", () => {
  expect(categorySecretConfirm({ title: "일기", secret: true, color: "#e57ad6" }, 2, { locked: true })).toEqual({
    icon: "shield",
    iconColor: "#e57ad6",
    title: "일기를 일반 카테고리로 바꿀까요?",
    body: "바꾸면 잠금과 상관없이 이 카테고리와 그 할 일 2개가 늘 보여요. 모든 기기에 같이 적용돼요.",
    choices: [{ id: "switch", label: "일반으로 바꾸기" }],
  });
  // Not Hangul at the end: both particles.
  expect(categorySecretConfirm({ title: "Diary", secret: true }, 0).title).toBe("Diary을(를) 일반 카테고리로 바꿀까요?");
});
