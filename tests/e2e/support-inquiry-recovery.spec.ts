import { expect, test } from "@playwright/test";

test("inquiry drafts survive closing and a network failure permits retry without duplicate sends", async ({ page }) => {
  let sends = 0;
  await page.route("**/api/support/inquiries", async route => {
    sends++;
    if (sends === 1) await route.abort("connectionreset");
    else await route.fulfill({ json: { ok: true, id: "fixture" } });
  });
  await page.goto("/support");
  await page.getByRole("button", { name: "1:1 문의", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "1:1 문의" });
  await dialog.getByLabel("제목", { exact: true }).fill("문의 테스트");
  await dialog.getByRole("textbox", { name: "내용", exact: true }).fill("유지되어야 하는 문의 초안");
  await dialog.getByLabel("이메일 또는 연락처").fill("qa@example.invalid");
  await dialog.getByRole("button", { name: "취소", exact: true }).click();
  await page.getByRole("button", { name: "1:1 문의", exact: true }).click();
  await expect(dialog.getByRole("textbox", { name: "내용", exact: true })).toHaveValue("유지되어야 하는 문의 초안");
  await dialog.getByRole("button", { name: "보내기", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("문의 접수 결과를 확인하지 못했습니다");
  await expect(dialog.getByRole("button", { name: "보내기", exact: true })).toBeEnabled();
  await expect(dialog.getByRole("textbox", { name: "내용", exact: true })).toHaveValue("유지되어야 하는 문의 초안");
  expect(sends).toBe(1);
  await dialog.getByRole("button", { name: "보내기", exact: true }).click();
  await expect(dialog.getByText("접수 완료", { exact: true })).toBeVisible();
  expect(sends).toBe(2);
});
