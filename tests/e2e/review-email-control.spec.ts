import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";
let html: string;
test.beforeAll(async () => {
  // The submission's customer mail comes from the server page as props; the
  // retry server action is replaced by a recorder.
  const emails = JSON.stringify([
    { id: "11111111-1111-4111-8111-111111111111", recipient: "customer@example.test", subject: "[onside] 결제 완료 및 심의 접수 안내", operation: "payment completed", status: "accepted", attempts: 1, createdAt: "2026-11-03T10:00:00Z", acceptedAt: "2026-11-03T10:00:05Z", nextAttemptAt: null },
    { id: "22222222-2222-4222-8222-222222222222", recipient: "customer@example.test", subject: "[onside] 심의 결과 안내", operation: "review result", status: "failed", attempts: 5, createdAt: "2026-11-03T11:00:00Z", acceptedAt: null, nextAttemptAt: null },
    { id: "33333333-3333-4333-8333-333333333333", recipient: "customer@example.test", subject: "[onside] 심의 업데이트 안내", operation: "submission update", status: "uncertain", attempts: 1, createdAt: "2026-11-03T12:00:00Z", acceptedAt: null, nextAttemptAt: null },
  ]);
  const bundle = await build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {ReviewEmailControl} from './src/components/admin/review-email-control';const params=new URLSearchParams(location.search);createRoot(document.getElementById('root')).render(<ReviewEmailControl submissionId="44444444-4444-4444-8444-444444444444" returnTo="/admin/submissions?type=ALBUM" customerEmails={params.has('mail')?${emails}:[]} customerEmailsUnavailable={params.has('broken')}/>);` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' }, plugins: [{ name: "router", setup(plugin) {
    plugin.onResolve({ filter: /^(next\/navigation|@\/app\/admin\/emails\/actions)$/ }, args => ({ path: args.path, namespace: "fixture" }));
    plugin.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ loader: "js", contents: args.path === "next/navigation"
      ? "export const useRouter=()=>({refresh(){}});"
      : "export const retryEmailAction=async form=>{(window.__retries||(window.__retries=[])).push(Object.fromEntries(form.entries()));};" }));
  } }] });
  html = `<!doctype html><html lang="ko"><body><div id="root"></div><script>${bundle.outputFiles[0].text.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
});
async function mount(page: Page, query = "") {
  const state = { previews: 0, sends: [] as Record<string, unknown>[], conflict: false, ready: true };
  await page.route("**/*", async route => {
    const request = route.request();
    if (request.resourceType() === "document") return route.fulfill({ contentType: "text/html", body: html });
    if (request.url().endsWith("/result-email")) {
      if (request.method() === "GET") { state.previews++; return route.fulfill({ json: { subject: "방송용 MV 현재 결과", html: "<h1>방송사별 심의 결과</h1><p>KBS: 12세 이상 시청가</p><p>MBC: 15세 이상 시청가</p><p>SBS: 심의중</p>", recipientMasked: "te***@example.test", revision: "a".repeat(64), updatedAt: "2026-10-25T00:00:00Z", canSend: state.ready, attachmentCount: state.ready ? 0 : 3, missingAssets: state.ready ? [] : ["영등위 필증"], warnings: [] } }); }
      state.sends.push(request.postDataJSON());
      if (state.conflict) return route.fulfill({ status: 409, json: { error: "저장된 결과가 변경되었습니다. 미리보기를 다시 확인해주세요." } });
      return route.fulfill({ json: { ok: true, notification: { queuedCount: 1 } } });
    }
    return route.fulfill({ status: 404 });
  });
  await page.goto(`https://review-email.test/${query}`);
  return state;
}

test("preview includes all current broadcasters and sends one summary only after the explicit button", async ({ page }) => {
  const state = await mount(page);
  await expect(page.getByRole("button", { name: "이 내용으로 이메일 발송" })).toHaveCount(0);
  await page.getByRole("button", { name: "이메일 발송 · 현재 결과 확인", exact: true }).click();
  await expect(page.frameLocator('iframe').getByText("KBS: 12세 이상 시청가")).toBeVisible();
  await expect(page.frameLocator('iframe').getByText("MBC: 15세 이상 시청가")).toBeVisible();
  await expect(page.frameLocator('iframe').getByText("SBS: 심의중")).toBeVisible();
  expect(state.sends).toHaveLength(0);
  await page.getByRole("button", { name: "이 내용으로 이메일 발송", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("발송 대기열");
  expect(state.sends).toHaveLength(1);
  expect(state.sends[0]).toMatchObject({ expectedRevision: "a".repeat(64), expectedUpdatedAt: "2026-10-25T00:00:00Z" });
  expect(String(state.sends[0].requestId)).toMatch(/^[0-9a-f-]{36}$/);
  await expect(page.getByRole("button", { name: "이 내용으로 이메일 발송" })).toHaveCount(0);
});

test("a changed preview is rejected and missing online attachments disable sending", async ({ page }) => {
  const state = await mount(page);
  await page.getByRole("button", { name: "이메일 발송 · 현재 결과 확인", exact: true }).click();
  state.conflict = true;
  await page.getByRole("button", { name: "이 내용으로 이메일 발송", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("미리보기를 다시 확인");
  await expect(page.getByRole("button", { name: "이 내용으로 이메일 발송" })).toHaveCount(0);
  state.ready = false;
  await page.getByRole("button", { name: "이메일 발송 · 현재 결과 확인", exact: true }).click();
  await expect(page.getByText("발송 준비 필요: 영등위 필증")).toBeVisible();
  await expect(page.getByRole("button", { name: "이 내용으로 이메일 발송" })).toBeDisabled();
  expect(state.sends).toHaveLength(1);
});

test("the email history lists only this submission's customer mail and stays folded until opened", async ({ page }) => {
  await mount(page, "?mail");
  const toggle = page.getByRole("button", { name: /이메일 발송 내역 \(3건\)/ });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByText("결제 완료 안내")).toHaveCount(0);
  await expect(page.locator('a[href="/admin/emails"]')).toHaveCount(0);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByText("이 접수의 고객에게 보낸 메일만 표시합니다.", { exact: false })).toBeVisible();
  await expect(page.getByText("결제 완료 안내")).toBeVisible();
  await expect(page.getByText("메일 서버 접수", { exact: true })).toBeVisible();
  await expect(page.getByText("발송 실패", { exact: true })).toBeVisible();
  // Accepted mail has no retry; failed and uncertain mail do, and uncertain needs the duplicate acknowledgement.
  await expect(page.getByRole("button", { name: "재발송 예약" })).toHaveCount(2);
  await page.getByRole("button", { name: "재발송 예약" }).first().click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __retries?: unknown[] }).__retries ?? [])).toEqual([
    { id: "22222222-2222-4222-8222-222222222222", submissionId: "44444444-4444-4444-8444-444444444444", returnTo: "/admin/submissions?type=ALBUM" },
  ]);
  await page.getByRole("button", { name: "재발송 예약" }).nth(1).click();
  expect(await page.evaluate(() => (window as unknown as { __retries?: unknown[] }).__retries?.length)).toBe(1);
});

test("an empty or unavailable history says so, and the anchor opens the list", async ({ page }) => {
  await mount(page, "#customer-emails");
  await expect(page.getByRole("button", { name: /이메일 발송 내역 \(0건\)/ })).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByText("이 접수로 고객에게 보낸 메일 기록이 없습니다.", { exact: false })).toBeVisible();
  await mount(page, "?broken");
  await page.getByRole("button", { name: /이메일 발송 내역/ }).click();
  await expect(page.getByRole("alert")).toContainText("발송 내역을 불러오지 못했습니다");
});
