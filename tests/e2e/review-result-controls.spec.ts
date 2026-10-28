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
        import {EnglishLanguagePack} from './src/components/i18n/english-language-pack';
        const params=new URLSearchParams(location.search);
        const mode=params.get('mode');
        const english=params.get('locale')==='en';
        document.documentElement.classList.toggle('dark',params.get('theme')==='dark');
        const tracks=[{id:'one',track_no:1,track_title:'첫 번째 노래'},{id:'two',track_no:2,track_title:'두 번째 노래'}];
        const submission={id:'fixture',title:'결과 버튼 확인 음반',artist_name:'테스트 아티스트',type:'ALBUM',is_oneclick:false,status:'COMPLETED',payment_status:'PAID',amount_krw:10000,created_at:'2026-10-16T00:00:00Z',updated_at:'2026-10-16T00:00:00Z',package:{name:'방송국 3곳',station_count:3,price_krw:10000},album_tracks:tracks};
        const reviews=['APPROVED','REJECTED','APPROVED','SENT'].map((status,index)=>({id:'review-'+index,status,result_note:status==='REJECTED'?'가사 수정 필요':null,track_results:status==='SENT'?[]:tracks.map((t,trackIndex)=>({track_id:t.id,track_no:t.track_no,title:t.track_title,status:index===2&&trackIndex===1?'REJECTED':status})),updated_at:submission.updated_at,station:{id:'station-'+index,name:['KBS','MBC','CBS','SBS'][index],code:['KBS','MBC','CBS','SBS'][index]}}));
        const compactReviews=['NOT_SENT','SENT','APPROVED','REJECTED','NEEDS_FIX','APPROVED'].map((status,index)=>({id:'compact-'+index,status,result_note:status==='REJECTED'?'가사 수정 필요':null,track_results:['APPROVED','REJECTED'].includes(status)?tracks.map((t,trackIndex)=>({track_id:t.id,track_no:t.track_no,title:t.track_title,status:index===5&&trackIndex===1?'REJECTED':status})):[],updated_at:submission.updated_at,station:{id:'station-'+index,name:['KBS','MBC','SBS','YTN','CBS','ARIRANG'][index],code:['KBS','MBC','SBS','YTN','CBS','ARIRANG'][index]}}));
        const content=mode==='detail'
          ? <SubmissionDetailClient submissionId="fixture" initialSubmission={submission} initialStationReviews={reviews} initialFiles={[]} enableRealtime={false} resultsOnly />
          : mode==='list'
            ? <SubmissionStatusList submissions={[{...submission,station_reviews:reviews}]} />
            : <HomeReviewPanel isLoggedIn={false} albumSubmissions={[submission]} mvSubmissions={[]} albumStationsMap={{fixture:mode==='compact'?compactReviews:reviews}} mvStationsMap={{}} hideEmptyTabs showDetailLink={false} compact={mode==='compact'} panelMinHeightClassName="" />;
        createRoot(document.getElementById('root')).render(<>{english?<EnglishLanguagePack/>:null}<main style={{padding:16,maxWidth:mode==='compact'?500:1100,margin:'auto'}}>{content}</main></>);
      ` },
      bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
      define: { "process.env": '{"NODE_ENV":"production"}' },
      plugins: [{ name: "isolated-result-services", setup(builder) {
        builder.onResolve({ filter: /^(@\/lib\/supabase\/client|@\/features\/submissions\/actions|next\/navigation|next\/image|next\/link)$/ }, args => ({ path: args.path, namespace: "mock" }));
        builder.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ loader: "tsx", resolveDir: process.cwd(), contents: args.path === "next/navigation"
          ? `export const useRouter=()=>({refresh(){},push(){}});export const usePathname=()=>new URLSearchParams(location.search).get('locale')==='en'?'/en/track':'/track';`
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
      for (const mode of ["detail", "home", "list"]) {
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
        if (mode === "home" || mode === "list") {
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

for (const width of [320, 390, 640, 1440]) {
  for (const theme of ["light", "dark"]) {
    for (const locale of ["ko", "en"]) {
      test(`compact station pairs stay aligned and readable at ${width}px in ${theme} ${locale}`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width, height: 1100 });
        const errors: string[] = [];
        page.on("pageerror", error => errors.push(error.message));
        await page.route("**/*", async route => {
          if (route.request().resourceType() === "document") {
            return route.fulfill({ contentType: "text/html", body: html });
          }
          const pathname = new URL(route.request().url()).pathname;
          if (/^\/station-logos\/[a-z0-9_.-]+\.(?:svg|png|webp)$/i.test(pathname)) {
            return route.fulfill({ contentType: pathname.endsWith(".svg") ? "image/svg+xml" : pathname.endsWith(".webp") ? "image/webp" : "image/png", body: await readFile(resolve("public", pathname.slice(1))) });
          }
          return route.fulfill({ status: 404 });
        });
        await page.goto(`/__review-result-controls?mode=compact&theme=${theme}&locale=${locale}`);
        const rows = page.locator("[data-station-row]");
        const statuses = page.locator("[data-station-status]");
        await expect(rows).toHaveCount(6);
        // The production language pack waits for hydration before translating.
        // Measure after it runs, including the longer English track summaries.
        if (locale === "en") await expect(page.getByText("Sample", { exact: true })).toBeVisible();
        await expect(statuses.nth(0)).toHaveText(locale === "en" ? "Queued" : "접수예정");
        await expect(statuses.nth(4)).toHaveText(locale === "en" ? "Fix needed" : "보완 요청");
        await expect(statuses.nth(5)).toHaveText(locale === "en" ? "Partial" : "부분 적격");
        for (const header of ["방송국", "Station", "Status"]) {
          await expect(page.getByText(header, { exact: true })).toHaveCount(0);
        }
        await expect(rows.locator("img")).toHaveCount(6);
        await expect.poll(() => rows.locator("img").evaluateAll(images => images.every(image => (image as HTMLImageElement).naturalWidth > 0))).toBe(true);

        const geometry = await rows.evaluateAll(elements => elements.map(element => {
          const rect = element.getBoundingClientRect();
          const logo = element.querySelector("img")!.getBoundingClientRect();
          const badge = element.querySelector("[data-station-status]")!.getBoundingClientRect();
          return {
            x: rect.x, y: rect.y, width: rect.width, height: rect.height,
            logo: { x: logo.x, y: logo.y, width: logo.width, height: logo.height },
            badge: { x: badge.x, y: badge.y, width: badge.width, height: badge.height },
            fits: element.scrollWidth <= element.clientWidth,
          };
        }));
        for (let index = 0; index < geometry.length; index += 2) {
          const left = geometry[index];
          const right = geometry[index + 1];
          expect(Math.abs(left.y - right.y)).toBeLessThanOrEqual(1);
          expect(left.x + left.width).toBeLessThanOrEqual(right.x + 1);
          if (index > 0) expect(left.y).toBeGreaterThanOrEqual(geometry[index - 2].y + geometry[index - 2].height - 1);
        }
        for (const entry of geometry) {
          expect(entry.height).toBeGreaterThanOrEqual(44);
          expect(entry.x).toBeGreaterThanOrEqual(0);
          expect(entry.x + entry.width).toBeLessThanOrEqual(width);
          expect(entry.fits).toBe(true);
          expect(entry.logo.x + entry.logo.width).toBeLessThanOrEqual(entry.badge.x + 1);
          expect(Math.abs((entry.logo.y + entry.logo.height / 2) - (entry.badge.y + entry.badge.height / 2))).toBeLessThanOrEqual(entry.height / 2);
          expect(entry.badge.x + entry.badge.width).toBeLessThanOrEqual(entry.x + entry.width + 1);
        }
        const badgeWidths = await statuses.evaluateAll(elements => elements.map(element => {
          const style = getComputedStyle(element);
          const contentWidth = element.firstElementChild!.getBoundingClientRect().width;
          const spacing = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)
            + parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
          return { width: element.getBoundingClientRect().width, contentWidth, spacing };
        }));
        for (const badge of badgeWidths) {
          expect(badge.width).toBeLessThanOrEqual(badge.contentWidth + badge.spacing + 1);
        }
        const colors = await statuses.evaluateAll(elements => elements.map(element => {
          const style = getComputedStyle(element);
          const probe = document.createElement("canvas").getContext("2d")!;
          probe.fillStyle = style.backgroundColor;
          probe.fillRect(0, 0, 1, 1);
          const rgba = Array.from(probe.getImageData(0, 0, 1, 1).data);
          return { rgba, border: style.borderColor, borderWidth: parseFloat(style.borderWidth), fits: element.scrollWidth <= element.clientWidth };
        }));
        for (const color of colors) {
          const [red, green, blue, alpha] = color.rgba;
          expect(alpha).toBe(255);
          expect(Math.max(red, green, blue) - Math.min(red, green, blue)).toBeGreaterThan(75);
          expect(Math.min(red, green, blue)).toBeLessThan(150);
          expect(color.border).toBe("rgb(17, 17, 17)");
          expect(color.borderWidth).toBeGreaterThanOrEqual(1);
          expect(color.fits).toBe(true);
        }
        const [yellow, blue, green, red, orange] = colors.map(color => color.rgba);
        expect(yellow[0]).toBeGreaterThan(180); expect(yellow[1]).toBeGreaterThan(150); expect(yellow[2]).toBeLessThan(100);
        expect(blue[2]).toBeGreaterThan(blue[0] + 60);
        expect(green[1]).toBeGreaterThan(green[0] + 40);
        expect(red[0]).toBeGreaterThan(red[1] + 70);
        expect(orange[0]).toBeGreaterThan(orange[1] + 60); expect(orange[1]).toBeGreaterThan(orange[2] + 30);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        expect(await rows.nth(0).evaluate(element => element.tagName)).toBe("SPAN");
        expect(await rows.nth(1).evaluate(element => element.tagName)).toBe("SPAN");
        await page.screenshot({ path: testInfo.outputPath(`compact-${width}-${theme}-${locale}.png`), fullPage: true });
        await rows.nth(3).focus();
        await page.keyboard.press("Enter");
        const dialog = page.getByRole("dialog");
        await expect(dialog).toBeVisible();
        await expect(dialog.getByText(/첫 번째 노래/)).toBeVisible();
        expect(errors).toEqual([]);
      });
    }
  }
}
