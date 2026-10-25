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
      const unpaid=params.has('unpaid');
      const pending=params.has('pending');
      const original=params.has('original');
      const completed=params.has('completed');
      const status=refunded||completed?'COMPLETED':progressed?'IN_PROGRESS':'PRE_REVIEW';
      const review={id:'review-fixture',station_id:'kbs',status:progressed?'SENT':'NOT_SENT',updated_at:'2026-10-25T00:00:00Z',track_results:[],station:{id:'kbs',name:'KBS',code:'KBS'}};
      const reviews=type==='MV_DISTRIBUTION'?[]:[review];
      const submission={id:'11111111-1111-4111-8111-111111111111',title:original?'이전':'Paid review fixture',artist_name:original?'다음':'Fixture artist',type,status,payment_status:refunded?'REFUNDED':pending?'PAYMENT_PENDING':unpaid?'UNPAID':'PAID',payment_method:'CARD',amount_krw:50000,is_oneclick:false,created_at:'2026-10-25T00:00:00Z',updated_at:'2026-10-25T00:00:00Z',package:{name:'방송국 1곳',station_count:1,price_krw:50000},album_tracks:[],station_reviews:reviews};
      if(completed) Object.assign(submission,{artist_name_kr:'닫기',artist_name_en:'Open Artist',ai_used:false,applicant_name:'신청자 원문',applicant_phone:'010-0000-0000',applicant_email:'fixture@example.invalid',distributor:'유통사 원문',production_company:'제작사 원문',release_date:'2026-10-25',genre:'장르 원문',artist_type:'SOLO',artist_gender:'FEMALE',mv_runtime:'03:30',mv_format:'MP4',mv_director:'감독 원문',mv_lead_actor:'주연 원문',mv_storyline:'이전 다음 이야기',mv_production_company:'제작사 원문',mv_agency:'기획사 원문',mv_album_title:'앨범 원문',mv_production_date:'2026-10-01',mv_distribution_company:'배급사 원문',mv_business_reg_no:'000-00-00000',mv_usage:'용도 원문',mv_desired_rating:'15',mv_song_title_official:'곡 원문',mv_composer:'작곡가 원문',mv_lyricist:'작사가 원문',mv_arranger:'편곡가 원문',mv_memo:'메모 원문',mv_lyrics:'다음 이전 가사 원문',result_status:'APPROVED',result_notified_at:'2026-10-25T01:00:00Z',certificate_b2_path:'fixture/certificate.pdf',certificate_original_name:'필증 원문.pdf'});
      const files=completed?[{id:'file-fixture',kind:'VIDEO',file_path:'fixture/video.mp4',original_name:'영상 원문.mp4',mime:'video/mp4',size:1024,created_at:'2026-10-25T00:00:00Z'}]:[];
      createRoot(document.getElementById('root')).render(<><section aria-label="목록"><SubmissionStatusList submissions={[submission]}/></section><section aria-label="상세"><SubmissionDetailClient submissionId={submission.id} initialSubmission={submission} initialFiles={files} initialStationReviews={reviews} enableRealtime={false} initialDataComplete={true} paymentState={params.get('payment')||undefined}/></section><EnglishLanguagePack/></>);
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
  html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main id="root"></main><script>${bundle.outputFiles[0].text.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
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


test("payment URL feedback cannot claim success before stored approval or override a completed payment", async ({ page }) => {
  await page.route("**/*", route => route.request().resourceType() === "document"
    ? route.fulfill({ contentType: "text/html", body: html }) : route.fulfill({ status: 404 }));
  await page.goto("http://paid-review.fixture.invalid/dashboard/status?type=ALBUM&unpaid&payment=success");
  await expect(page.getByRole("heading", { name: "결제 승인 상태를 확인 중입니다. 잠시 후 진행상황을 다시 확인해주세요.", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "결제가 완료되었습니다.", exact: true })).toHaveCount(0);
  await page.goto("http://paid-review.fixture.invalid/dashboard/status?type=ALBUM&payment=cancel");
  await expect(page.getByRole("heading", { name: "결제가 완료되었습니다.", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "결제가 취소되었습니다.", exact: true })).toHaveCount(0);
});

test("English customer status leaves Korean titles and artist names unchanged", async ({ page }) => {
  const errors: string[]=[];page.on("pageerror", error=>errors.push(error.message));
  await page.route("**/*", route => route.request().resourceType() === "document"
    ? route.fulfill({ contentType: "text/html", body: html }) : route.fulfill({ status: 404 }));
  await page.goto("http://paid-review.fixture.invalid/en/dashboard/status?type=ALBUM&original");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("main")).toContainText("Pending Submission");
  await expect(page.locator("[data-no-translate]").filter({hasText:/^이전$/})).toHaveCount(2);
  await expect(page.locator("[data-no-translate]").filter({hasText:/^다음$/})).toHaveCount(2);
  expect(errors).toEqual([]);
});


test("card approval awaiting confirmation directs customers to Orders without offering another charge", async ({page})=>{
  await page.route("**/*", route=>route.request().resourceType()==="document"?route.fulfill({contentType:"text/html",body:html}):route.fulfill({status:404}));
  await page.goto("http://paid-review.fixture.invalid/dashboard/status?type=ALBUM&pending");
  await expect(page.getByRole("heading", {name:"결제 확인 대기",exact:true})).toBeVisible();
  await expect(page.getByRole("button", {name:"주문내역 확인",exact:true})).toHaveCount(2);
  await expect(page.getByRole("button", {name:"결제하기",exact:true})).toHaveCount(0);
});

test("populated English MV results and expanded application translate controls while preserving submitted content", async ({page})=>{
  const errors: string[]=[];
  page.on("pageerror", error=>errors.push(error.message));
  await page.route("**/*", route=>route.request().resourceType()==="document"?route.fulfill({contentType:"text/html",body:html}):route.fulfill({status:404}));
  await page.goto("http://paid-review.fixture.invalid/en/dashboard/status?type=MV_DISTRIBUTION&original&completed");
  await expect(page.locator("html")).toHaveAttribute("lang","en");
  await page.getByRole("button",{name:"Open application form",exact:true}).click();
  await page.getByRole("button",{name:"Open application details",exact:true}).click();
  await page.getByRole("button",{name:"Open attachments",exact:true}).click();
  await expect(page.locator("[data-no-translate]").filter({hasText:/^ \/ 닫기$/})).toHaveText(" / 닫기");
  await expect(page.locator("[data-no-translate]").filter({hasText:/^영상 원문.mp4$/})).toBeVisible();
  const untranslatedText = () => page.locator("main").evaluate(root=>{
    const texts: string[]=[];
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
    for(let node=walker.nextNode();node;node=walker.nextNode()) {
      const parent=node.parentElement;
      if(!parent || parent.closest("[data-no-translate],[translate='no'],script,style") || !parent.getClientRects().length) continue;
      const value=node.textContent?.trim()??"";
      if(/[가-힣]/.test(value)) texts.push(value);
    }
    return [...new Set(texts)];
  });
  await expect.poll(untranslatedText).toEqual([]);
  const detail=page.locator("section").filter({has:page.locator("#submission-form-section")}).first();
  await detail.getByRole("button",{name:/Korea Media Rating Board.*Approved/}).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.locator("[data-no-translate]").filter({hasText:/^필증 원문.pdf$/})).toBeVisible();
  await expect.poll(untranslatedText).toEqual([]);
  expect(errors).toEqual([]);
});
