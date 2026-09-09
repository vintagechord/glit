import { expect, test } from "@playwright/test";

// The real Next page runs, but every mutation/upload is intercepted so no draft,
// account record, notification or payment reaches a live service.
for (const state of ["failed", "stalled"] as const) test(`MV ${state} upload can hand off by email and proceed without the stale upload blocking it`, async ({ page }) => {
  const id = "11111111-1111-4111-8111-111111111111";
  const token = "22222222-2222-4222-8222-222222222222";
  const saves: string[] = []; const unexpected: string[] = []; const errors: string[] = [];
  let drafts = 0; let puts = 0; let release: (() => void) | undefined;
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", async route => {
    const request = route.request(); const url = new URL(request.url());
    if (url.pathname === "/api/submissions/draft") { drafts++; await route.fulfill({ json: { submissionId: id, guestToken: token } }); return; }
    if (url.pathname === "/api/uploads/init") { await route.fulfill({ json: { key: `submissions/fixture/${id}/video.mp4`, uploadUrl: `${url.origin}/__e2e__/mv-upload`, headers: { "Content-Type": "video/mp4" } } }); return; }
    if (url.pathname === "/__e2e__/mv-upload") {
      puts++;
      if (state === "stalled") await new Promise<void>(resolve => { release = resolve; });
      await route.fulfill({ status: state === "failed" ? 400 : 200, body: "", headers: { ETag: '"fixture"' } }); return;
    }
    if (url.pathname === "/api/uploads/complete") { await route.fulfill({ json: { key: `submissions/fixture/${id}/video.mp4` } }); return; }
    if (request.headers()["next-action"]) { saves.push(request.postData() ?? ""); await route.fulfill({ contentType: "text/x-component", body: `0:${JSON.stringify({ a: { submissionId: id, guestToken: token }, f: "" })}\n` }); return; }
    if (["GET", "HEAD", "OPTIONS"].includes(request.method()) || url.pathname === "/__nextjs_original-stack-frames") { await route.continue(); return; }
    unexpected.push(`${request.method()} ${url.pathname}`); await route.fulfill({ status: 409, json: { error: "Unexpected mutation blocked" } });
  });
  try {
    await page.goto("/dashboard/new/mv");
    await expect.poll(() => drafts).toBeGreaterThan(0);
    await page.getByRole("button", { name: "다음 단계", exact: true }).click();
    await page.getByRole("radio", { name: /파일로 제출/ }).click();
    await page.getByRole("button", { name: "선택하고 계속", exact: true }).click();
    await page.getByRole("button", { name: "사용 안 함", exact: true }).click();
    await page.getByRole("button", { name: "파일 업로드로 이동", exact: true }).click();
    const files = page.locator('[data-preflight-field="files"]');
    await expect(files).toBeVisible();
    await files.locator('input[type="file"]').setInputFiles({ name: "fixture.mp4", mimeType: "video/mp4", buffer: Buffer.from("fixture video bytes") });
    await expect.poll(() => puts).toBeGreaterThan(0);
    if (state === "failed") await expect(files.getByText("실패", { exact: true })).toBeVisible();
    else await expect(files.locator('input[type="file"]')).toBeDisabled();
    await files.getByRole("button", { name: "파일 없이 진행", exact: true }).click();
    await expect(files).toContainText("아래 이메일 주소로 영상 파일을 보내주세요.");
    await page.getByRole("button", { name: "다음 단계", exact: true }).click();
    await expect(page.getByRole("button", { name: "장바구니에 담기", exact: true })).toBeVisible();
    expect(saves.some(body => body.includes('"filesSubmittedByEmail":true'))).toBe(true);
    release?.();
    await expect(page.getByRole("button", { name: "장바구니에 담기", exact: true })).toBeEnabled();
    expect(errors).toEqual([]); expect(unexpected).toEqual([]);
  } finally { release?.(); }
});
