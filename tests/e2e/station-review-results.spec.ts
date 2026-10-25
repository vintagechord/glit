import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";

let html: string;

test.beforeAll(async () => {
  const bundle = await build({
    stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {StationReviewForm} from './src/components/admin/station-review-form';
      import {SubmissionDetailClient} from './src/features/submissions/submission-detail-client';
      import {saveStationReview} from './src/lib/admin/station-review-save';
      import {createClient} from '@/lib/supabase/client';
      const isWbs=location.search.includes('wbs');
      const tracks=[{id:'track-one',track_no:1,track_title:'첫 번째 노래'},{id:'track-two',track_no:2,track_title:'두 번째 노래'},...(isWbs?[{id:'track-three',track_no:3,track_title:'세 번째 노래'},{id:'track-four',track_no:4,track_title:'네 번째 노래'}]:[])];
      const submission={id:'fixture-submission',title:'심의 테스트 음반',artist_name:'테스트 아티스트',type:'ALBUM',status:'IN_PROGRESS',payment_status:'PAID',amount_krw:10000,created_at:'2026-10-16T00:00:00Z',updated_at:'2026-10-16T00:00:00Z',package:{name:'방송국 1곳',station_count:1,price_krw:10000},album_tracks:tracks,result_status:null,result_memo:null};
      const review={id:'review',submission_id:submission.id,station_id:'station',status:isWbs?'APPROVED':'SENT',result_note:null,track_results:[],updated_at:submission.updated_at,station:{id:'station',name:isWbs?'WBS':'KBS',code:isWbs?'WBS':'KBS'}};
      window.__reviewDb={submission,reviews:[review]};
      function App(){
        const [error,setError]=React.useState('');
        async function save(form){
          const result=await saveStationReview(createClient(),{reviewId:'review',submissionId:submission.id,stationId:'station',status:form.get('station_status'),resultNote:form.get('station_memo'),trackResults:JSON.parse(form.get('track_results_json'))});
          setError(result.error||'');
          if(!result.error) window.__reviewNotify();
        }
        return <><section aria-label="관리자 심의 결과 입력"><StationReviewForm submissionId={submission.id} reviewId="review" stationId="station" stationName={review.station.name} maxDecidedTracks={isWbs?3:undefined} initialStatus="SENT" initialMemo="" trackResults={tracks.map(t=>({id:t.id,track_no:t.track_no,title:t.track_title,status:'PENDING'}))} statusOptions={[{value:'SENT',label:'접수완료'},{value:'APPROVED',label:'적격'},{value:'REJECTED',label:'부적격'},{value:'NEEDS_FIX',label:'수정요청'}]} action={save}/>{error&&<p role="alert">{error}</p>}</section><section aria-label="의뢰자 심의 결과"><SubmissionDetailClient submissionId={submission.id} initialSubmission={submission} initialStationReviews={[review]} initialFiles={[]} resultsOnly /></section></>;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env": '{"NODE_ENV":"production"}' },
    plugins: [{ name: "isolated-review-services", setup(builder) {
      builder.onResolve({ filter: /^@\/lib\/supabase\/client$/ }, () => ({ path: "supabase", namespace: "mock" }));
      builder.onResolve({ filter: /^@\/features\/submissions\/actions$/ }, () => ({ path: "actions", namespace: "mock" }));
      builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "navigation", namespace: "mock" }));
      builder.onResolve({ filter: /^next\/image$/ }, () => ({ path: "image", namespace: "mock" }));
      builder.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ loader: "tsx", resolveDir: process.cwd(), contents: args.path === "actions" ? `export const getSubmissionFileUrlAction=async()=>({error:"Not part of this fixture"});` : args.path === "navigation"
        ? `const router={refresh(){window.__reviewNotify?.()},push(){}};export const useRouter=()=>router;export const usePathname=()=>'/mypage/submissions/fixture';`
        : args.path === "image" ? `export default function Image({unoptimized,fill,priority,...props}){return <img {...props}/>}`
        : `const callbacks=new Set();window.__reviewNotify=()=>callbacks.forEach(callback=>callback());
          export const createClient=()=>({
            from(table){let payload;const query={
              update(value){payload=value;return query},eq(){return query},
              select(){if(!payload)return query;if(window.__failReviewSave)return Promise.resolve({data:null,error:{code:'42501',message:'fixture failure'}});const row={...window.__reviewDb.reviews[0],...payload,track_results:payload.track_results_json??payload.track_results};window.__reviewDb.reviews=[row];return Promise.resolve({data:[row],error:null})},
              maybeSingle(){return Promise.resolve({data:window.__reviewDb.submission,error:null})},
              order(){return Promise.resolve({data:table==='station_reviews'?window.__reviewDb.reviews:[],error:null})}
            };return query},
            channel(){const owned=[];return {on(_event,_filter,callback){owned.push(callback);return this},subscribe(){owned.forEach(c=>callbacks.add(c));return this},owned}},
            removeChannel(channel){channel.owned.forEach(c=>callbacks.delete(c))}
          });`
      }));
    } }],
  });
  html = `<!doctype html><html lang="ko"><head><style>body{font-family:sans-serif}.fixed{position:fixed;inset:0;background:white;z-index:10}.hidden{display:none}</style></head><body><div id="root"></div><script>${bundle.outputFiles[0].text.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
});

async function mount(page: Page, query = "") {
  await page.route("**/*", route => route.request().resourceType() === "document"
    ? route.fulfill({ contentType: "text/html", body: html })
    : route.fulfill({ status: 404 }));
  page.on("dialog", dialog => dialog.accept());
  await page.goto(`http://review-results.test/${query}`);
}

async function save(page: Page) {
  await page.getByRole("region", { name: "관리자 심의 결과 입력" }).getByRole("button", { name: "저장", exact: true }).click();
}

test("administrator results reach the requester live and unlock radio requests only when all tracks finish", async ({ page }) => {
  await mount(page);
  const requester = page.getByRole("region", { name: "의뢰자 심의 결과" });
  await expect(requester.getByTestId("broadcast-support")).toHaveCount(0);
  await page.getByLabel("첫 번째 노래 심의 결과").selectOption("APPROVED");
  await page.getByLabel("KBS 의뢰자에게 전달할 메모").fill("첫 곡 확인 완료, 두 번째 곡 확인 중");
  await save(page);
  await expect(requester.getByRole("button", { name: /KBS · 접수완료/ })).toBeVisible();
  await expect(requester.getByText("결과 0/1", { exact: true })).toBeVisible();
  await expect(requester.getByTestId("broadcast-support")).toHaveCount(0);
  await requester.getByRole("button", { name: /KBS · 접수완료/ }).click();
  await expect(page.getByRole("dialog").getByText("첫 곡 확인 완료, 두 번째 곡 확인 중")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "닫기", exact: true }).click();

  await page.getByLabel("두 번째 노래 심의 결과").selectOption("REJECTED");
  await save(page);
  await expect(requester.getByText("결과 1/1", { exact: true })).toBeVisible();
  await expect(requester.getByRole("button", { name: /KBS · 부분 적격/ })).toBeVisible();
  await expect(requester.getByTestId("broadcast-support")).toBeVisible();
  await expect(requester.getByLabel("신청할 적격 곡").locator("option")).toHaveText(["첫 번째 노래"]);
});

test("overall approval fills each track, preserves approval notes and correction requests revoke completion", async ({ page }) => {
  await mount(page);
  const requester = page.getByRole("region", { name: "의뢰자 심의 결과" });
  await page.getByLabel("KBS 심의 상태").selectOption("APPROVED");
  await expect(page.getByLabel("첫 번째 노래 심의 결과")).toHaveValue("APPROVED");
  await expect(page.getByLabel("두 번째 노래 심의 결과")).toHaveValue("APPROVED");
  await page.getByLabel("KBS 의뢰자에게 전달할 메모").fill("두 곡 모두 방송 적격입니다.");
  await save(page);
  await requester.getByRole("button", { name: /KBS · 적격/ }).click();
  await expect(page.getByRole("dialog").getByText("두 곡 모두 방송 적격입니다.")).toBeVisible();
  await expect(page.getByRole("dialog").getByText("심의 결과 메모", { exact: true })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "닫기", exact: true }).click();
  await page.getByLabel("KBS 심의 상태").selectOption("NEEDS_FIX");
  await save(page);
  await expect(requester.getByRole("button", { name: /KBS · 보완 요청/ })).toBeVisible();
  await expect(requester.getByTestId("broadcast-support")).toHaveCount(0);
});

test("failed admin save leaves the requester waiting without a false approval", async ({ page }) => {
  await mount(page);
  await page.evaluate(() => { (window as unknown as { __failReviewSave: boolean }).__failReviewSave = true; });
  await page.getByLabel("KBS 심의 상태").selectOption("APPROVED");
  await save(page);
  await expect(page.getByRole("alert")).toContainText("저장하지 못했습니다");
  const requester = page.getByRole("region", { name: "의뢰자 심의 결과" });
  await expect(requester.getByRole("button", { name: /KBS · 접수완료 · 0곡 적격/ })).toBeVisible();
  await expect(requester.getByTestId("broadcast-support")).toHaveCount(0);
});

test("focus refresh recovers missed realtime events and displays the overall result memo", async ({ page }) => {
  await mount(page);
  await page.evaluate(() => {
    const db = (window as unknown as { __reviewDb: { submission: Record<string, unknown>; reviews: Array<Record<string, unknown>> } }).__reviewDb;
    db.submission.result_status = "APPROVED";
    db.submission.result_memo = "관리자가 전달한 전체 심의 결과입니다.";
    db.reviews = [{ ...db.reviews[0], status: "APPROVED", track_results: [
      { track_id: "track-one", status: "APPROVED" },
      { track_id: "track-two", status: "APPROVED" },
    ] }];
    window.dispatchEvent(new Event("focus"));
  });
  const requester = page.getByRole("region", { name: "의뢰자 심의 결과" });
  await expect(requester.getByText("관리자가 전달한 전체 심의 결과입니다.", { exact: true })).toBeVisible();
  await expect(requester.getByText("결과 1/1", { exact: true })).toBeVisible();
  await expect(requester.getByTestId("broadcast-support")).toBeVisible();
});


test("WBS without recorded targets cannot inherit approval and accepts exactly three actual track decisions", async ({ page }) => {
  await mount(page, "?wbs=1");
  const requester = page.getByRole("region", { name: "의뢰자 심의 결과" });
  await expect(requester.getByRole("button", { name: /WBS · 심의곡 확인 필요/ })).toBeVisible();
  await expect(requester.getByTestId("broadcast-support")).toHaveCount(0);
  await expect(page.getByLabel("WBS 심의 상태").locator('option[value="APPROVED"]')).toBeDisabled();
  for (const title of ["첫 번째 노래", "두 번째 노래", "네 번째 노래"]) {
    await page.getByLabel(`${title} 심의 결과`).selectOption("APPROVED");
  }
  await expect(page.getByLabel("세 번째 노래 심의 결과").locator('option[value="APPROVED"]')).toBeDisabled();
  await save(page);
  await expect(requester.getByRole("button", { name: /WBS · 적격/ })).toBeVisible();
  await expect(requester.getByTestId("broadcast-support")).toBeVisible();
  await expect(requester.getByLabel("신청할 적격 곡").locator("option")).toHaveText(["첫 번째 노래", "두 번째 노래", "네 번째 노래"]);
});
