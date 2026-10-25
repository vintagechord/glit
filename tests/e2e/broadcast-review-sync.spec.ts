import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";

let html: string;
test.beforeAll(async () => {
  const bundle = await build({
    stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
      import React from 'react';import {createRoot} from 'react-dom/client';
      import {StationReviewForm} from './src/components/admin/station-review-form';
      import {SubmissionDetailClient} from './src/features/submissions/submission-detail-client';
      import {saveManagedStationReview} from './src/lib/admin/review-management';
      import {createClient} from '@/lib/supabase/client';
      const submission={id:'11111111-1111-4111-8111-111111111111',title:'방송용 뮤비',artist_name:'테스트 아티스트',type:'MV_BROADCAST',status:'IN_PROGRESS',payment_status:'PAID',amount_krw:10000,created_at:'2026-10-25T00:00:00.000Z',updated_at:'2026-10-25T00:00:00.000Z',package:{name:'방송국 2곳',station_count:2,price_krw:10000},album_tracks:[],result_status:null,result_memo:null};
      const stations=[{id:'33333333-3333-4333-8333-333333333333',code:'KBS',name:'KBS'},{id:'44444444-4444-4444-8444-444444444444',code:'MBC',name:'MBC'}];
      const initial=stations.map((station,i)=>({id:(i?'66666666-6666-4666-8666-666666666666':'55555555-5555-4555-8555-555555555555'),submission_id:submission.id,station_id:station.id,status:'SENT',age_rating:null,result_note:null,track_results:[],updated_at:submission.updated_at,station}));
      window.__reviewDb={submission,reviews:initial};window.__saveCalls=0;
      function App(){const [reviews,setReviews]=React.useState(initial);const [error,setError]=React.useState('');
        async function save(form){const result=await saveManagedStationReview(createClient(),{submissionId:submission.id,actorUserId:'22222222-2222-4222-8222-222222222222',stationId:form.get('station_id'),reviewId:form.get('review_id'),expectedUpdatedAt:form.get('expected_updated_at'),status:form.get('station_status'),ageRating:form.get('age_rating')||null,resultNote:form.get('station_memo')});setError(result.error||'');if(result.ok){setReviews([...window.__reviewDb.reviews]);window.__reviewNotify()}}
        return <><section aria-label="관리자 방송 심의">{reviews.map(review=><StationReviewForm key={review.id+review.updated_at} submissionId={submission.id} reviewId={review.id} stationId={review.station_id} stationName={review.station.name} initialStatus={review.status} initialMemo={review.result_note||''} expectedUpdatedAt={review.updated_at} showAgeRating initialAgeRating={review.age_rating} trackResults={[]} statusOptions={[{value:'SENT',label:'접수완료'},{value:'APPROVED',label:'적격'},{value:'REJECTED',label:'부적격'},{value:'NEEDS_FIX',label:'수정요청'}]} action={save}/>)}{error&&<p role="alert">{error}</p>}</section><section aria-label="의뢰자 방송 심의"><SubmissionDetailClient submissionId={submission.id} initialSubmission={submission} initialStationReviews={initial} initialFiles={[]} resultsOnly /></section></>
      }createRoot(document.getElementById('root')).render(<App/>);
    ` },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env": '{"NODE_ENV":"production"}' },
    plugins: [{ name: "isolated-broadcast", setup(builder) {
      builder.onResolve({ filter: /^@\/lib\/supabase\/client$/ }, () => ({ path: "db", namespace: "fixture" }));
      builder.onResolve({ filter: /^@\/features\/submissions\/actions$/ }, () => ({ path: "actions", namespace: "fixture" }));
      builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "navigation", namespace: "fixture" }));
      builder.onResolve({ filter: /^next\/image$/ }, () => ({ path: "image", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ loader: "tsx", resolveDir: process.cwd(), contents: args.path === "actions" ? "export const getSubmissionFileUrlAction=async()=>({error:'fixture'});" : args.path === "navigation" ? "const router={refresh(){window.__reviewNotify?.()},push(){}};export const useRouter=()=>router;export const usePathname=()=>'/mypage/submissions/fixture';" : args.path === "image" ? "export default function Image({unoptimized,fill,priority,...props}){return <img {...props}/>;}" : `
        const callbacks=new Set();window.__reviewNotify=()=>callbacks.forEach(callback=>callback());
        export const createClient=()=>({from(table){const filters={};const result=()=>({data:table==='submissions'?window.__reviewDb.submission:table==='station_reviews'?(filters.station_id?window.__reviewDb.reviews.find(r=>r.station_id===filters.station_id):window.__reviewDb.reviews):table==='stations'?window.__reviewDb.reviews.find(r=>r.station_id===filters.id)?.station:[],error:null});const query={select(){return query},eq(key,value){filters[key]=value;return query},maybeSingle(){return Promise.resolve(result())},order(){return Promise.resolve(result())},then(resolve){return Promise.resolve(result()).then(resolve)}};return query},
        async rpc(name,args){window.__saveCalls++;const index=window.__reviewDb.reviews.findIndex(r=>r.station_id===args.p_station_id);const old=window.__reviewDb.reviews[index];if(old.updated_at!==args.p_expected_updated_at)return {data:null,error:{message:'REVIEW_CONFLICT'}};const row={...old,status:args.p_status,age_rating:args.p_age_rating,result_note:args.p_result_note,updated_at:'2026-10-25T00:00:0'+window.__saveCalls+'.000Z'};window.__reviewDb.reviews[index]=row;const complete=window.__reviewDb.reviews.every(r=>['APPROVED','REJECTED'].includes(r.status));window.__reviewDb.submission={...window.__reviewDb.submission,status:complete?'RESULT_READY':'IN_PROGRESS',result_status:complete?'APPROVED':null};return {data:{completed:true,changed:true,row,submissionStatus:window.__reviewDb.submission.status},error:null}},
        channel(){const owned=[];return {on(_event,_filter,callback){owned.push(callback);return this},subscribe(){owned.forEach(c=>callbacks.add(c));return this},owned}},removeChannel(channel){channel.owned.forEach(c=>callbacks.delete(c))}});` }));
    } }],
  });
  html = `<!doctype html><html lang="ko"><head><style>body{font-family:sans-serif}.fixed{position:fixed;inset:0;background:white;z-index:10}.hidden{display:none}</style></head><body><div id="root"></div><script>${bundle.outputFiles[0].text.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
});
async function mount(page: Page) {
  await page.route("**/*", route => route.request().resourceType() === "document" ? route.fulfill({ contentType: "text/html", body: html }) : route.fulfill({ status: 404 }));
  page.on("dialog", dialog => dialog.accept());
  await page.goto("http://broadcast-review.test/");
}
const form = (page: Page, station: string) => page.locator("form").filter({ has: page.getByLabel(`${station} 심의 상태`, { exact: true }) });

test("broadcast forms require a rating and publish independent KBS/MBC grades to the requester", async ({ page }) => {
  await mount(page);
  const requester = page.getByRole("region", { name: "의뢰자 방송 심의" });
  await page.getByLabel("KBS 심의 상태", { exact: true }).selectOption("APPROVED");
  await form(page, "KBS").getByRole("button", { name: "저장", exact: true }).click();
  expect(await page.getByLabel("KBS 연령 등급").evaluate(element => (element as HTMLSelectElement).validity.valueMissing)).toBe(true);
  expect(await page.evaluate(() => (window as unknown as { __saveCalls: number }).__saveCalls)).toBe(0);
  await page.getByLabel("KBS 연령 등급").selectOption("12");
  await form(page, "KBS").getByRole("button", { name: "저장", exact: true }).click();
  await expect(requester.getByRole("button", { name: /KBS · 12세 이상 시청가/ })).toBeVisible();
  await expect(requester.getByRole("button", { name: /MBC · 결과대기/ })).toBeVisible();
  await page.getByLabel("MBC 심의 상태", { exact: true }).selectOption("APPROVED");
  await page.getByLabel("MBC 연령 등급").selectOption("15");
  await form(page, "MBC").getByRole("button", { name: "저장", exact: true }).click();
  await expect(requester.getByRole("button", { name: /MBC · 15세 이상 시청가/ })).toBeVisible();
  await expect(requester.getByRole("button", { name: /KBS · 12세 이상 시청가/ })).toBeVisible();
  await expect(requester.getByTestId("broadcast-support")).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("a stale broadcaster form displays a conflict without overwriting a newer result", async ({ page }) => {
  await mount(page);
  await page.getByLabel("KBS 심의 상태", { exact: true }).selectOption("APPROVED");
  await page.getByLabel("KBS 연령 등급").selectOption("19");
  await page.evaluate(() => { const state = (window as unknown as { __reviewDb: { reviews: Array<Record<string, unknown>> } }).__reviewDb; state.reviews[0] = { ...state.reviews[0], updated_at: "2026-10-25T00:05:00.000Z", status: "APPROVED", age_rating: "12" }; });
  await form(page, "KBS").getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("다른 화면에서");
  expect(await page.evaluate(() => (window as unknown as { __reviewDb: { reviews: Array<{ age_rating: string }> } }).__reviewDb.reviews[0].age_rating)).toBe("12");
  expect(await page.evaluate(() => (window as unknown as { __saveCalls: number }).__saveCalls)).toBe(0);
});
