import { expect, test } from "@playwright/test";
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
        import {HomeReviewPanel} from './src/features/home/home-review-panel';
        import {SubmissionStatusList} from './src/components/dashboard/submission-status-list';
        import {SubmissionDetailClient} from './src/features/submissions/submission-detail-client';
        const params=new URLSearchParams(location.search);
        const mode=params.get('mode');
        document.documentElement.classList.toggle('dark',params.get('theme')==='dark');
        const tracks=[{id:'one',track_no:1,track_title:'첫 번째 노래'},{id:'two',track_no:2,track_title:'두 번째 노래'}];
        const submission={id:'fixture',title:'결과 버튼 확인 음반',artist_name:'테스트 아티스트',type:'ALBUM',is_oneclick:false,status:'COMPLETED',payment_status:'PAID',amount_krw:10000,created_at:'2026-10-16T00:00:00Z',updated_at:'2026-10-16T00:00:00Z',package:{name:'방송국 3곳',station_count:3,price_krw:10000},album_tracks:tracks};
        const reviews=['APPROVED','REJECTED','APPROVED','SENT'].map((status,index)=>({id:'review-'+index,status,result_note:status==='REJECTED'?'가사 수정 필요':null,track_results:status==='SENT'?[]:tracks.map((t,trackIndex)=>({track_id:t.id,track_no:t.track_no,title:t.track_title,status:index===2&&trackIndex===1?'REJECTED':status})),updated_at:submission.updated_at,station:{id:'station-'+index,name:['KBS','MBC','CBS','SBS'][index],code:['KBS','MBC','CBS','SBS'][index]}}));
        const content=mode==='detail'
          ? <SubmissionDetailClient submissionId="fixture" initialSubmission={submission} initialStationReviews={reviews} initialFiles={[]} enableRealtime={false} resultsOnly />
          : mode==='list'
            ? <SubmissionStatusList submissions={[{...submission,station_reviews:reviews}]} />
            : <HomeReviewPanel isLoggedIn={false} albumSubmissions={[submission]} mvSubmissions={[]} albumStationsMap={{fixture:reviews}} mvStationsMap={{}} hideEmptyTabs showDetailLink={false} compact={mode==='compact'} panelMinHeightClassName="" />;
        createRoot(document.getElementById('root')).render(<main style={{padding:16,maxWidth:mode==='compact'?500:1100,margin:'auto'}}>{content}</main>);
      ` },
      bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
      define: { "process.env": '{"NODE_ENV":"production"}' },
      plugins: [{ name: "isolated-result-services", setup(builder) {
        builder.onResolve({ filter: /^(@\/lib\/supabase\/client|@\/features\/submissions\/actions|next\/navigation|next\/image|next\/link)$/ }, args => ({ path: args.path, namespace: "mock" }));
        builder.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ loader: "tsx", resolveDir: process.cwd(), contents: args.path === "next/navigation"
          ? `export const useRouter=()=>({refresh(){},push(){}});export const usePathname=()=>'/track';`
          : args.path === "next/image" ? `export default function Image({unoptimized,fill,priority,...props}){return <img {...props}/>}`
          : args.path === "next/link" ? `export default function Link({prefetch,replace,scroll,...props}){return <a {...props}/>}`
          : args.path.includes("supabase") ? `export const createClient=()=>{throw Error('No database calls allowed')};`
          : `export const getSubmissionFileUrlAction=async()=>({error:'Fixture does not download files'});`
        }));
      } }],
    }),
    readFile(resolve("src/app/globals.css"), "utf8").then(css => postcss([tailwind()]).process(css, { from: resolve("src/app/globals.css") })),
  ]);
  html = `<!doctype html><html lang="ko"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css.css}</style></head><body><div id="root"></div><script>${bundle.outputFiles[0].text.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
});

for (const width of [320, 640, 1440]) {
  for (const theme of ["light", "dark"]) {
    test(`result controls match detail and keep their actions at ${width}px in ${theme}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.route("**/*", route => route.request().resourceType() === "document"
        ? route.fulfill({ contentType: "text/html", body: html }) : route.fulfill({ status: 404 }));
      let reference: unknown;
      for (const mode of ["detail", "home", "compact", "list"]) {
        await page.goto(`/__review-result-controls?mode=${mode}&theme=${theme}`);
        if (mode === "list") await page.getByRole("button", { name: "상세 보기", exact: true }).click();
        const controls = page.locator("[data-review-result-control]");
        await expect(controls).toHaveCount(4);
        const styles = await controls.evaluateAll(elements => elements.slice(0, 3).map(element => {
          const style = getComputedStyle(element);
          return {
            height: style.height,
            minHeight: style.minHeight,
            minWidth: style.minWidth,
            borderRadius: style.borderRadius,
            borderWidth: style.borderWidth,
            borderColor: style.borderColor,
            backgroundColor: style.backgroundColor,
            color: style.color,
            fontSize: style.fontSize,
            fontWeight: style.fontWeight,
            lineHeight: style.lineHeight,
            letterSpacing: style.letterSpacing,
            shadow: style.boxShadow,
          };
        }));
        if (mode === "detail") reference = styles;
        else expect(styles).toEqual(reference);
        await expect(controls.nth(2)).toContainText("부분 적격");
        await expect(controls.nth(2)).toContainText("1곡 적격");
        await expect(controls.nth(2)).toContainText("1곡 부적격");
        for (const control of await controls.all()) {
          const rect = (await control.boundingBox())!;
          expect(rect.height).toBeGreaterThanOrEqual(44);
          expect(rect.x).toBeGreaterThanOrEqual(0);
          expect(rect.x + rect.width).toBeLessThanOrEqual(width);
          expect(await control.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        if (mode === "home" || mode === "compact" || mode === "list") {
          expect(await controls.nth(3).evaluate(element => element.tagName)).toBe("SPAN");
        }
        await page.screenshot({ path: testInfo.outputPath(`${mode}-${width}-${theme}.png`), fullPage: true });
        const result = page.getByRole("button", { name: mode === "detail" ? /MBC · 부적격/ : "MBC 부적격 결과 보기" });
        await result.focus();
        await page.keyboard.press("Enter");
        const dialog = page.getByRole("dialog", { name: mode === "detail" ? "트랙별 결과" : mode === "list" ? "MBC 트랙별 결과" : "MBC 심의 결과" });
        await expect(dialog).toBeVisible();
        await expect(dialog.getByText(/첫 번째 노래/)).toBeVisible();
        await expect(dialog.getByText(/가사 수정 필요/).first()).toBeVisible();
      }
      expect(errors).toEqual([]);
    });
  }
}
