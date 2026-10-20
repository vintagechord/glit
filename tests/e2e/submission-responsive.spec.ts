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
        import {StationReviewForm} from './src/components/admin/station-review-form';
        import {SubmissionDetailClient} from './src/features/submissions/submission-detail-client';
        const long='LongTitleWithoutSpaces'.repeat(6);
        const tracks=[{id:'one',track_no:1,track_title:long,composer:long,lyrics:long},{id:'two',track_no:2,track_title:'두 번째 노래'}];
        const submission={id:'fixture',title:long,artist_name:long,applicant_email:long+'@example.com',melon_url:'https://example.com/'+long,type:'ALBUM',status:'COMPLETED',payment_status:'PAID',amount_krw:10000,created_at:'2026-10-16T00:00:00Z',updated_at:'2026-10-16T00:00:00Z',package:{name:'방송국 1곳',station_count:1,price_krw:10000},album_tracks:tracks,result_status:'APPROVED',result_memo:long};
        const review={id:'review',status:'APPROVED',result_note:long,track_results:[{track_id:'one',status:'APPROVED'},{track_id:'two',status:'APPROVED'}],updated_at:submission.updated_at,station:{id:'station',name:'KBS',code:'KBS'}};
        const admin=location.search.includes('admin');
        createRoot(document.getElementById('root')).render(admin ? <main style={{padding:16}}><StationReviewForm submissionId="fixture" stationId="station" stationName={long} initialStatus="APPROVED" initialMemo={long} trackResults={tracks.map(t=>({id:t.id,track_no:t.track_no,title:t.track_title,status:'APPROVED'}))} statusOptions={[{value:'SENT',label:'접수완료'},{value:'APPROVED',label:'적격'},{value:'REJECTED',label:'부적격'}]} action={async()=>{}}/></main> : <SubmissionDetailClient submissionId="fixture" initialSubmission={submission} initialStationReviews={[review]} initialFiles={[{id:'file',kind:'AUDIO',file_path:'fixture',original_name:long+'.wav',size:1024,mime:'audio/wav',created_at:submission.created_at}]} enableRealtime={false} resultsOnly={location.search.includes('results')}/>);
      ` },
      bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
      define: { "process.env": '{"NODE_ENV":"production"}' },
      plugins: [{ name: "isolated-responsive-services", setup(builder) {
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
  html = `<!doctype html><html lang="ko"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css.css}</style></head><body><div id="root"></div><script>${bundle.outputFiles[0].text.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
});

async function expectContained(page: Page, width: number) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  const overflowing = await page.locator("body *").evaluateAll((elements, viewport) => elements
    .filter(element => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && (rect.right > viewport + 1 || rect.left < -1);
    }).map(element => `${element.tagName}.${element.className}`).slice(0, 6), width);
  expect(overflowing).toEqual([]);
}

for (const width of [320, 360, 390, 768]) {
  for (const mode of ["results", "full", "admin"]) {
    test(`${mode} keeps long content and controls within ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.route("**/*", route => route.request().resourceType() === "document"
        ? route.fulfill({ contentType: "text/html", body: html }) : route.fulfill({ status: 404 }));
      await page.goto(`/__responsive-review?${mode}`);
      if (mode === "admin") {
        await expect(page.getByRole("button", { name: "저장", exact: true })).toBeVisible();
        for (const control of await page.locator("input:not([type=hidden]),select,button").all()) {
          expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        }
      } else {
        await expect(page.getByTestId("broadcast-support")).toBeVisible();
        await page.getByText("심의 기록 · 방송 참고자료", { exact: true }).click();
        if (mode === "full") {
          await page.getByRole("button", { name: "작성 신청서 열기" }).click();
          await page.getByRole("button", { name: "첨부 파일 열기" }).click();
        }
        await expectContained(page, width);
        await page.getByRole("button", { name: /KBS · 적격/ }).click();
        const dialog = page.getByRole("dialog", { name: "트랙별 결과" });
        await expect(dialog).toBeVisible();
        expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
        if (width === 320) await page.screenshot({ path: testInfo.outputPath("track-results-dialog.png") });
        await dialog.getByRole("button", { name: "닫기", exact: true }).click();
      }
      await expectContained(page, width);
      await page.screenshot({ path: testInfo.outputPath(`${mode}-${width}.png`), fullPage: true });
      expect(errors).toEqual([]);
    });
  }
}
