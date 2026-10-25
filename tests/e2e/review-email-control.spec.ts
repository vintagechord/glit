import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";
let html: string;
test.beforeAll(async () => {
  const bundle = await build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {ReviewEmailControl} from './src/components/admin/review-email-control';createRoot(document.getElementById('root')).render(<ReviewEmailControl submissionId="fixture"/>);` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' }, plugins: [{ name: "router", setup(plugin) { plugin.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "router", namespace: "fixture" })); plugin.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export const useRouter=()=>({refresh(){}});", loader: "js" })); } }] });
  html = `<!doctype html><html lang="ko"><body><div id="root"></div><script>${bundle.outputFiles[0].text.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
});
async function mount(page: Page) {
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
  await page.goto("https://review-email.test/");
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
