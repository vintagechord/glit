import { expect, test } from "@playwright/test";
import { build } from "esbuild";

let html: string;
test.beforeAll(async () => {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {SubmissionDetailClient} from './src/features/submissions/submission-detail-client';
      import {SubmissionStatusList} from './src/components/dashboard/submission-status-list';
      import {EnglishLanguagePack} from './src/components/i18n/english-language-pack';
      const params=new URLSearchParams(location.search);
      const type=params.get('type')||'ALBUM';
      const progressed=params.has('progressed');
      const refunded=params.has('refunded');
      const status=refunded?'COMPLETED':progressed?'IN_PROGRESS':'PRE_REVIEW';
      const review={id:'review-fixture',station_id:'kbs',status:progressed?'SENT':'NOT_SENT',updated_at:'2026-10-25T00:00:00Z',track_results:[],station:{id:'kbs',name:'KBS',code:'KBS'}};
      const reviews=type==='MV_DISTRIBUTION'?[]:[review];
      const submission={id:'11111111-1111-4111-8111-111111111111',title:'Paid review fixture',artist_name:'Fixture artist',type,status,payment_status:refunded?'REFUNDED':'PAID',payment_method:'CARD',amount_krw:50000,is_oneclick:false,created_at:'2026-10-25T00:00:00Z',updated_at:'2026-10-25T00:00:00Z',package:{name:'방송국 1곳',station_count:1,price_krw:50000},album_tracks:[],station_reviews:reviews};
      createRoot(document.getElementById('root')).render(<><section aria-label="목록"><SubmissionStatusList submissions={[submission]}/></section><section aria-label="상세"><SubmissionDetailClient submissionId={submission.id} initialSubmission={submission} initialFiles={[]} initialStationReviews={reviews} enableRealtime={false} initialDataComplete={true}/></section><EnglishLanguagePack/></>);
    ` },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env": '{"NODE_ENV":"production"}' },
    plugins: [{ name: "paid-review-fixture", setup(builder) {
      builder.onResolve({ filter: /^(next\/(?:navigation|image)|@\/lib\/supabase\/client|@\/features\/submissions\/actions)$/ }, args => ({ path: args.path, namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ loader: "tsx", resolveDir: process.cwd(), contents:
        path === "next/navigation" ? `const router={push(){throw new Error('Unexpected navigation')},refresh(){}};export const useRouter=()=>router;export const usePathname=()=>location.pathname;` :
        path === "next/image" ? `export default function Image({unoptimized,fill,priority,...props}){return <img {...props}/>}` :
        path === "@/features/submissions/actions" ? `export const getSubmissionFileUrlAction=async()=>({error:'Fixture excludes files'});` :
        `export const createClient=()=>{throw new Error('Unexpected database access')};`,
      }));
    } }],
  });
  html = `<!doctype html><html lang="ko"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main id="root"></main><script>${bundle.outputFiles[0].text.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
});

for (const type of ["ALBUM", "MV_DISTRIBUTION", "MV_BROADCAST"]) {
  test(`${type}: confirmed payment remains pending submission in list and customer detail`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => route.request().resourceType() === "document"
      ? route.fulfill({ contentType: "text/html", body: html }) : route.fulfill({ status: 404 }));
    await page.goto(`http://paid-review.fixture.invalid/dashboard/status?type=${type}`);
    await expect(page.getByRole("region", { name: "목록", exact: true })).toContainText("접수예정");
    const detail = page.getByRole("region", { name: "상세", exact: true });
    await expect(detail.getByRole("heading", { name: "접수예정", exact: true })).toBeVisible();
    await expect(detail.getByRole("button", { name: /(?:KBS|영상물등급위원회) · 접수예정/ })).toBeVisible();
    await expect(detail.getByRole("button", { name: "결제하기", exact: true })).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test("actual online MV processing is preserved after payment", async ({ page }) => {
  await page.route("**/*", route => route.request().resourceType() === "document"
    ? route.fulfill({ contentType: "text/html", body: html }) : route.fulfill({ status: 404 }));
  await page.goto("http://paid-review.fixture.invalid/dashboard/status?type=MV_DISTRIBUTION&progressed");
  const detail = page.getByRole("region", { name: "상세", exact: true });
  await expect(detail.getByRole("heading", { name: "심의 진행 중", exact: true })).toBeVisible();
  await expect(detail.getByRole("button", { name: /영상물등급위원회 · 접수완료/ })).toBeVisible();
});


test("a refunded completed submission is neither labeled paid nor offered another payment", async ({ page }) => {
  await page.route("**/*", route => route.request().resourceType() === "document"
    ? route.fulfill({ contentType: "text/html", body: html }) : route.fulfill({ status: 404 }));
  await page.goto("http://paid-review.fixture.invalid/dashboard/status?type=ALBUM&refunded");
  const detail = page.getByRole("region", { name: "상세", exact: true });
  await expect(detail.getByRole("heading", { name: "환불", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "목록", exact: true })).toContainText("환불");
  await expect(page.getByRole("button", { name: "결제하기", exact: true })).toHaveCount(0);
});
