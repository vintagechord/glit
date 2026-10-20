import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

let html: string;
test.beforeAll(async () => {
  const [bundle, css] = await Promise.all([
    build({
      stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
        import React from 'react';
        import {createRoot} from 'react-dom/client';
        import {SubmissionDetailClient} from './src/features/submissions/submission-detail-client';
        const mode=new URLSearchParams(location.search).get('mode');
        const hasNoTrackDetails=mode==='mv'||mode==='legacy';
        const tracks=[{id:'one',track_no:1,track_title:'KBS에서 적격인 곡'},{id:'two',track_no:2,track_title:'Arirang에서 적격인 곡'}];
        const submission={id:'fixture',title:'두 방송국의 다른 심의 결과',artist_name:'테스트 아티스트',type:mode==='mv'?'MV_BROADCAST':'ALBUM',status:mode==='partial'?'IN_REVIEW':'COMPLETED',payment_status:'PAID',amount_krw:10000,created_at:'2026-10-17T00:00:00Z',updated_at:'2026-10-17T00:00:00Z',package:{name:'방송국 2곳',station_count:2,price_krw:10000},album_tracks:hasNoTrackDetails?[]:tracks};
        const reviews=[{id:'kbs-review',status:'APPROVED',result_note:null,track_results:[{track_id:'one',status:'APPROVED'},{track_id:'two',status:'REJECTED'}],updated_at:submission.updated_at,station:{id:'kbs-station',name:'KBS',code:'KBS'}},{id:'arirang-review',status:mode==='rejected'?'REJECTED':mode==='partial'?'SENT':'APPROVED',result_note:null,track_results:hasNoTrackDetails?null:[{track_id:'one',status:mode==='partial'?'PENDING':'REJECTED'},{track_id:'two',status:mode==='rejected'?'REJECTED':'APPROVED'}],updated_at:submission.updated_at,station:{id:'arirang-station',name:'Arirang',code:'ARIRANG'}}];
        createRoot(document.getElementById('root')).render(<SubmissionDetailClient submissionId="fixture" initialSubmission={submission} initialStationReviews={reviews} initialFiles={[]} enableRealtime={false} resultsOnly/>);
      ` },
      bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
      define: { "process.env": '{"NODE_ENV":"production"}' },
      plugins: [{ name: "isolated-radio-dialog", setup(builder) {
        builder.onResolve({ filter: /^(@\/lib\/supabase\/client|@\/features\/submissions\/actions|next\/navigation|next\/image)$/ }, args => ({ path: args.path, namespace: "mock" }));
        builder.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ loader: "tsx", resolveDir: process.cwd(), contents: args.path === "next/navigation"
          ? `export const useRouter=()=>({refresh(){},push(){}});export const usePathname=()=>'/mypage/submissions/fixture';`
          : args.path === "next/image" ? `export default function Image({unoptimized,fill,priority,...props}){return <img {...props}/>}`
          : args.path.includes("supabase") ? `export const createClient=()=>{throw Error('No database calls allowed')};`
          : `export const getSubmissionFileUrlAction=async()=>({error:'Fixture does not download files'});`
        }));
      } }],
    }),
    readFile(resolve("src/app/globals.css"), "utf8").then(css => postcss([tailwind()]).process(css, { from: resolve("src/app/globals.css") })),
  ]);
  html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css.css}</style></head><body><div id="root"></div><script>${bundle.outputFiles[0].text.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
});

async function mount(page: Page, mode = "") {
  await page.route("**/*", route => route.request().resourceType() === "document"
    ? route.fulfill({ contentType: "text/html", body: html })
    : route.fulfill({ status: 404, body: "External calls blocked" }));
  await page.goto(`/__radio-dialog?mode=${mode}`);
}

async function openArirang(page: Page) {
  const trigger = page.getByRole("button", { name: /Arirang ·/ });
  await trigger.click();
  const trackDialog = page.getByRole("dialog", { name: "트랙별 결과" });
  await trackDialog.getByRole("button", { name: "라디오 신청 가이드", exact: true }).click();
  return { trigger, dialog: page.getByRole("dialog", { name: /Arirang.*라디오 신청 가이드/ }) };
}

for (const width of [320, 390, 768, 1440]) {
  test(`Arirang keeps its own approved track and accessible dialog at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 800 });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await mount(page);
    if (width === 320) await page.locator("html").evaluate(element => element.classList.add("dark"));
    const { trigger, dialog } = await openArirang(page);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("radio-song-context")).toContainText("Arirang");
    await expect(dialog.getByTestId("radio-song-context")).toContainText("적격 곡");
    await expect(dialog.getByLabel("신청할 적격 곡").locator("option")).toHaveText(["Arirang에서 적격인 곡"]);
    await expect(dialog.getByRole("link")).toHaveCount(0);
    const close = dialog.getByRole("button", { name: "라디오 신청 가이드 닫기" });
    await expect(close).toBeFocused();
    expect((await close.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.body.style.position)).toBe("fixed");
    const bounds = (await dialog.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(800);
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.keyboard.press("Shift+Tab");
    expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
    await expect(close).not.toBeFocused();
    await page.keyboard.press("Tab");
    await expect(close).toBeFocused();
    await dialog.getByTestId("radio-guide-scroll").evaluate(element => { element.scrollTop = 0; });
    await page.screenshot({ path: testInfo.outputPath(`arirang-radio-dialog-${width}.png`) });
    await dialog.getByTestId("radio-guide-scroll").evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect(close).toBeInViewport();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    expect(await page.evaluate(() => document.body.style.position)).toBe("");
    expect(errors).toEqual([]);
  });
}

for (const width of [390, 1440]) {
  test(`legacy album approval keeps official request boards usable without track details at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 800 });
    await mount(page, "legacy");
    await page.getByRole("button", { name: /Arirang · 적격/ }).click();
    const dialog = page.getByRole("dialog", { name: /Arirang.*라디오 신청 가이드/ });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("신청할 적격 곡")).toHaveCount(0);
    await expect(dialog.getByLabel("게시글 제목")).toHaveCount(0);

    await expect(dialog.getByRole("button", { name: "이 곡으로 프로그램 고르기" })).toBeDisabled();
    await dialog.getByLabel("신청할 곡명 (필수)").fill("신청자의 직접 입력한 노래");
    await dialog.getByLabel("아티스트명 (필수)").fill("신청자 아티스트");
    await dialog.getByRole("button", { name: "이 곡으로 프로그램 고르기" }).click();
    const programs = dialog.getByRole("article");
    await expect(programs).toHaveCount(2);
    await expect(programs.nth(0).getByRole("link", { name: /프로그램 소개/ })).toHaveAttribute("href", "https://www.arirang.com/radio/125");
    await expect(programs.nth(1).getByRole("link", { name: /프로그램 소개/ })).toHaveAttribute("href", "https://www.arirang.com/radio/127");

    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await dialog.getByTestId("radio-guide-scroll").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    const first = (await programs.nth(0).boundingBox())!;
    const second = (await programs.nth(1).boundingBox())!;
    if (width === 1440) {
      expect(Math.abs(first.y - second.y)).toBeLessThan(2);
      expect(second.x).toBeGreaterThanOrEqual(first.x + first.width);
    } else {
      expect(second.y).toBeGreaterThanOrEqual(first.y + first.height);
    }
    await page.screenshot({ path: testInfo.outputPath(`arirang-legacy-radio-dialog-${width}.png`) });
  });
}

test("an approved track has its own guide while another track is still waiting", async ({ page }) => {
  await mount(page, "partial");
  await expect(page.getByTestId("broadcast-support")).toHaveCount(0);
  const { dialog } = await openArirang(page);
  await expect(dialog.getByLabel("신청할 적격 곡").locator("option")).toHaveText(["Arirang에서 적격인 곡"]);
});

test("closing and reopening the guide preserves the selected language and edited request", async ({ page }) => {
  await mount(page);
  let { dialog } = await openArirang(page);
  await dialog.getByRole("button", { name: "이 곡으로 프로그램 고르기" }).click();
  await dialog.getByRole("button", { name: "Radio’n Us 선택", exact: true }).click();
  await dialog.getByRole("button", { name: "이 프로그램으로 초안 만들기" }).click();
  await dialog.locator("summary").filter({ hasText: "내 이야기·음원 링크 더하기" }).click();
  await dialog.getByLabel("신청 문구 언어").selectOption("ko");
  await dialog.getByLabel("게시글 제목").fill("퇴근길에 함께 듣고 싶은 곡");
  await dialog.getByLabel("사연과 신청곡 문구").fill("오랜 친구와 함께 듣고 싶은 노래입니다. 이 사연을 다시 작성하지 않도록 남겨주세요.");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  ({ dialog } = await openArirang(page));
  await expect(dialog.getByLabel("신청 문구 언어")).toHaveValue("ko");
  await expect(dialog.getByTestId("radio-step-3")).toContainText("Radio’n Us");
  await expect(dialog.getByLabel("게시글 제목")).toHaveValue("퇴근길에 함께 듣고 싶은 곡");
  await expect(dialog.getByLabel("사연과 신청곡 문구")).toHaveValue("오랜 친구와 함께 듣고 싶은 노래입니다. 이 사연을 다시 작성하지 않도록 남겨주세요.");
});

test("a rejected broadcaster cannot open a song request guide", async ({ page }) => {
  await mount(page, "rejected");
  await page.getByRole("button", { name: /Arirang · 부적격/ }).click();
  await expect(page.getByRole("dialog", { name: "트랙별 결과" })).toBeVisible();
  await expect(page.getByRole("button", { name: "라디오 신청 가이드", exact: true })).toHaveCount(0);
});

test("video approval shows a separate audio review requirement without generating a song request", async ({ page }) => {
  await mount(page, "mv");
  await page.getByRole("button", { name: /Arirang · 적격/ }).click();
  const dialog = page.getByRole("dialog", { name: /Arirang.*라디오 신청 가이드/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("뮤직비디오 적격은 음원 적격과 별개입니다. 라디오 신청 전 해당 음원의 심의 결과를 확인하세요.")).toBeVisible();
  await expect(dialog.getByLabel("신청할 적격 곡")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "본문 복사" })).toHaveCount(0);
});

test("the station dialog shares its draft with the main panel without background focus stealing", async ({ page }) => {
  await mount(page);
  const mainPanel = page.locator("#broadcast-support");
  await expect(mainPanel.getByLabel("적격 방송국", { exact: true })).toHaveValue("kbs-review");
  const { dialog } = await openArirang(page);
  await dialog.getByRole("button", { name: "이 곡으로 프로그램 고르기" }).click();
  await dialog.getByRole("button", { name: "Radio’n Us 선택", exact: true }).click();
  await dialog.getByRole("button", { name: "이 프로그램으로 초안 만들기" }).click();
  const body = dialog.getByLabel("사연과 신청곡 문구");
  await body.fill("Arirang 창에서 쓰기 시작한 내 이야기");
  await expect(body).toBeFocused();
  expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(mainPanel.getByTestId("radio-song-context")).toContainText("Arirang");
  await expect(mainPanel.getByLabel("사연과 신청곡 문구")).toHaveValue("Arirang 창에서 쓰기 시작한 내 이야기");
  await mainPanel.getByLabel("사연과 신청곡 문구").fill("본문에서 이어서 쓴 같은 이야기");
  const reopened = (await openArirang(page)).dialog;
  await expect(reopened.getByLabel("사연과 신청곡 문구")).toHaveValue("본문에서 이어서 쓴 같은 이야기");
  await reopened.getByRole("button", { name: "1단계: 내 곡 확인", exact: true }).click();
  await expect(reopened.getByLabel("신청할 적격 곡").locator("option")).toHaveText(["Arirang에서 적격인 곡"]);
  await page.keyboard.press("Escape");
  await mainPanel.getByLabel("적격 방송국", { exact: true }).selectOption("kbs-review");
  await page.keyboard.press("Tab");
  await expect(mainPanel.getByLabel("적격 방송국", { exact: true })).toHaveValue("kbs-review");
  await expect(mainPanel.getByLabel("신청할 적격 곡").locator("option")).toHaveText(["KBS에서 적격인 곡"]);
});
