import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

// 접수 관리 list rows for paid albums (owner request 2026-11-25): each row
// names the stations still without a result and links to that station's form
// on the application page. Rendered alone; no database is reached.
let html: string;
test.beforeAll(async () => {
  const [bundle, css] = await Promise.all([
    build({
      stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
        import React from 'react';
        import {createRoot} from 'react-dom/client';
        import {PendingStationStrip} from './src/components/admin/pending-station-strip';
        import {summarizeAlbumStationProgress} from './src/lib/admin/album-station-progress';
        import {getPackageStationCodes, stationNameByCode} from './src/lib/station-reviews';
        import {StationReviewForm} from './src/components/admin/station-review-form';
        import {stationReviewAnchor} from './src/lib/admin/station-anchors';
        const codes=getPackageStationCodes(10,'10곳');
        const catalog=codes.map((code,i)=>({id:'st-'+i,name:stationNameByCode[code],code}));
        const review=(code,status)=>{const station=catalog.find(s=>s.code===code);return {submission_id:'a',station_id:station.id,status,station}};
        const sixOfTen=summarizeAlbumStationProgress({expectedCodes:codes,catalog,reviews:[
          review('MBC','APPROVED'),review('KBS','APPROVED'),review('SBS','REJECTED'),review('YTN','APPROVED'),
          review('CBS','APPROVED'),review('BBS','APPROVED'),review('TBS','SENT'),review('WBS','NEEDS_FIX')]});
        const none=summarizeAlbumStationProgress({expectedCodes:codes,catalog,reviews:[]});
        const done=summarizeAlbumStationProgress({expectedCodes:['KBS','MBC','SBS'],catalog,reviews:['KBS','MBC','SBS'].map(c=>review(c,'APPROVED'))});
        const Card=({id,title,progress})=>(<article id={id} className="rounded-[10px] border-2 border-border bg-card p-4 text-sm">
          <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(190px,0.75fr)_auto] lg:items-center">
            <div className="min-w-0"><p className="truncate text-base font-black">{title}</p><p className="mt-1 text-xs font-semibold text-muted-foreground">아티스트 · 앨범 심의</p></div>
            <div className="flex flex-wrap gap-1.5"><span className="inline-flex min-h-7 items-center rounded-[6px] border border-[var(--bauhaus-ink)] bg-[#1556a4] px-2.5 py-1 text-[11px] font-black text-white">심의 진행 중</span></div>
            <div className="rounded-[8px] border-2 border-border bg-background px-3 py-2 text-right text-xs font-black">260,000원</div>
          </div>
          <PendingStationStrip progress={progress} detailHref={'/admin/submissions/'+id+'?returnTo=%2Fadmin%2Fsubmissions'}/>
        </article>);
        createRoot(document.getElementById('root')).render(<main className="mx-auto grid w-full max-w-7xl gap-3 px-4 py-8">
          <Card id="six" title="여섯 곳 결과 입력된 앨범" progress={sixOfTen}/>
          <Card id="none" title="결과 입력 전 앨범" progress={none}/>
          <Card id="done" title="모든 결과 입력된 앨범" progress={done}/>
          <section id="form"><StationReviewForm submissionId="s" stationId="st-3" stationCode="TBS" stationName="TBS 교통방송"
            anchorId={stationReviewAnchor('TBS','st-3')} initialStatus="SENT" initialMemo="" expectedUpdatedAt={null}
            trackResults={[]} statusOptions={[{value:'NOT_SENT',label:'접수예정'},{value:'SENT',label:'접수완료'}]} action={async()=>{}}/></section>
        </main>);
      ` },
      bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
      define: { "process.env": '{"NODE_ENV":"production"}' },
      plugins: [{ name: "pending-stations-isolation", setup(builder) {
        builder.onResolve({ filter: /^next\/link$/ }, args => ({ path: args.path, namespace: "mock" }));
        builder.onLoad({ filter: /.*/, namespace: "mock" }, () => ({ loader: "tsx", resolveDir: process.cwd(),
          contents: "export default function Link({prefetch,...props}){return <a {...props}/>}" }));
      } }],
    }),
    readFile(resolve("src/app/globals.css"), "utf8").then(source => postcss([tailwind()]).process(source, { from: resolve("src/app/globals.css") })),
  ]);
  html = `<!doctype html><html lang="ko"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css.css}</style></head><body><div id="root"></div><script>${bundle.outputFiles[0].text.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
});

async function open(page: Page) {
  await page.route("**/*", route => route.request().resourceType() === "document"
    ? route.fulfill({ contentType: "text/html", body: html }) : route.fulfill({ status: 404 }));
  await page.goto("/__admin-pending-stations");
}

async function keep(page: Page, outputPath: string, name: string) {
  await page.screenshot({ path: outputPath, fullPage: true });
  // Kept for the owner to look at (tmp/shots is excluded from git locally).
  const kept = resolve(`tmp/shots/admin-pending-stations/${name}`);
  await mkdir(dirname(kept), { recursive: true });
  await copyFile(outputPath, kept);
}

test("a row names each station still without a result and links to its form", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await open(page);

  const six = page.locator("#six");
  await expect(six).toContainText("결과 미입력 4곳");
  await expect(six).toContainText("(6/10 입력)");
  const chips = six.getByRole("link");
  await expect(chips).toHaveText(["TBS", "PBC", "WBS· 보완 요청", "Arirang"]);
  // The full name stays one hover away.
  await expect(chips.first()).toHaveAttribute("title", "TBS 교통방송 결과 입력");
  await expect(chips.first()).toHaveAttribute("href", "/admin/submissions/six?returnTo=%2Fadmin%2Fsubmissions#station-TBS");
  await expect(six.getByRole("link", { name: /WBS/ })).toHaveAttribute("href", /#station-WBS$/);
  // The chip's target exists on the application page under the same name.
  await expect(page.locator("#station-TBS")).toHaveCount(1);
  await expect(page.locator("#station-TBS")).toHaveJSProperty("tagName", "FORM");

  const none = page.locator("#none");
  await expect(none).toContainText("결과 미입력 10곳");
  await expect(none.getByRole("link")).toHaveText(["전체 방송사"]);
  await expect(none.getByRole("link")).toHaveAttribute("href", /#station-results$/);

  // Every result in: nothing is added to the row.
  await expect(page.locator("#done")).not.toContainText("결과 미입력");
  await expect(page.locator("#done a")).toHaveCount(0);

  await keep(page, testInfo.outputPath("desktop.png"), "desktop.png");
});

test("the station chips wrap inside the card on a phone", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await open(page);
  const card = await page.locator("#six").boundingBox();
  const chipBoxes = await page.locator("#six a").evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().right));
  expect(card).not.toBeNull();
  for (const right of chipBoxes) expect(right).toBeLessThanOrEqual(card!.x + card!.width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await keep(page, testInfo.outputPath("phone.png"), "phone.png");
});
