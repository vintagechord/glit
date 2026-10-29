import { expect, test } from "@playwright/test";
import { build } from "esbuild";

let script: string;
test.beforeAll(async () => {
  const result = await build({
    stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {AlbumWizard} from './src/features/submissions/album-wizard';createRoot(document.getElementById('root')).render(React.createElement(AlbumWizard,window.applicantFixture));`, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", minify: true, define: { "process.env": '{"NODE_ENV":"production"}' },
    plugins: [{ name: "applicant-fixture-boundaries", setup(builder) {
      builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "navigation", namespace: "fixture" }));
      builder.onResolve({ filter: /^\.\/actions$/ }, args => args.importer.endsWith("album-wizard.tsx") ? { path: "actions", namespace: "fixture" } : undefined);
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ contents: path === "navigation"
        ? `const router={push(){},replace(){},refresh(){}};const params=new URLSearchParams(window.location.search);export const useRouter=()=>router;export const usePathname=()=>window.location.pathname;export const useSearchParams=()=>params;`
        : `export const saveAlbumSubmissionAction=async()=>{throw Error('External writes are blocked by the applicant UI fixture')};`, loader: "js" }));
    } }],
  });
  script = result.outputFiles[0].text;
});

for (const initialApplicant of [
  { name: "회원 이름", email: "member@example.invalid", phone: "01012345678" },
  { name: "회원 이름", email: "saved@example.invalid", phone: "" },
  { name: "", email: "", phone: "" },
]) test(`applicant defaults remain visible and editable with ${Object.values(initialApplicant).filter(Boolean).length} saved fields`, async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const props = {
    userId: "member-fixture", initialApplicant,
    packages: [{ id: "package-fixture", name: "KBS", stationCount: 1, priceKrw: 10000, stations: [{ id: "station-fixture", name: "KBS", code: "KBS" }] }],
    initialArchiveEntry: { context: { libraryId: "library-fixture", releaseId: "release-fixture" }, title: "불러온 앨범", artistName: "아티스트", albumUrl: "https://www.melon.com/album/detail.htm?albumId=123", tracks: [{ id: "track-fixture", title: "불러온 곡", discNumber: 1, trackNumber: 1 }] },
  };
  await page.context().route("**/*", async route => {
    if (new URL(route.request().url()).pathname === "/__fixture__/applicant.js") await route.fulfill({ contentType: "application/javascript; charset=utf-8", body: script });
    else if (route.request().resourceType() === "document") await route.fulfill({ contentType: "text/html", body: `<!doctype html><html lang="ko"><head><meta charset="utf-8"></head><body><div id="root"></div><script>window.applicantFixture=${JSON.stringify(props)};</script><script src="/__fixture__/applicant.js"></script></body></html>` });
    else if (route.request().method() === "GET") await route.fulfill({ json: { drafts: [] } });
    else await route.fulfill({ status: 409, json: { error: "External writes are blocked in this UI test." } });
  });
  await page.goto("/dashboard/new/album");
  for (const [key, value] of Object.entries(initialApplicant)) {
    const field = page.locator(`[data-preflight-field="applicant${key[0].toUpperCase()}${key.slice(1)}"]`);
    await expect(field).toBeVisible(); await expect(field).toHaveValue(value); await expect(field).toBeEditable();
  }
  const name = page.locator('[data-preflight-field="applicantName"]');
  const email = page.locator('[data-preflight-field="applicantEmail"]');
  const phone = page.locator('[data-preflight-field="applicantPhone"]');
  await name.fill("수정한 접수자"); await email.fill("edited@example.invalid"); await phone.fill("01087654321");
  await page.getByRole("button", { name: "사용 안 함", exact: true }).click();
  await expect(name).toHaveValue("수정한 접수자"); await expect(email).toHaveValue("edited@example.invalid"); await expect(phone).toHaveValue("01087654321");
  expect(errors).toEqual([]);
});
