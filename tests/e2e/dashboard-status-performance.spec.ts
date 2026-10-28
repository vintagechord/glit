import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";
import type { DashboardStatusData } from "../../src/lib/dashboard-status";

const makeData = (ids = ["first", "second"], status = "RECEIVED", updated = "2026-10-28T00:00:00Z"): DashboardStatusData => ({
  albumSubmissions: ids.map((id) => ({ id, title: id, artist_name: "Fixture", status: "IN_PROGRESS", payment_status: "PAID", created_at: "2026-10-28T00:00:00Z", updated_at: updated })),
  mvSubmissions: [],
  albumStationsMap: Object.fromEntries(ids.map((id) => [id, [{ id: `station-${id}`, submission_id: id, station_id: "kbs", status, updated_at: updated, station: { name: "KBS", code: "KBS" } }]])),
  mvStationsMap: {},
});
type Fixture = {
  render: (data: DashboardStatusData | null, viewerId?: string, initialDataAt?: number) => void;
  unmount: () => void;
  viewerId: string;
  refreshes: number;
  realtime: Record<string, () => Promise<void>>;
  stationRequests: { finish: (rows: DashboardStatusData["albumStationsMap"][string]) => void }[];
  requests: { signal: AbortSignal; finish: (data: DashboardStatusData) => void }[];
};
let html: string;
test.beforeAll(async () => {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {DashboardStatusClient} from './src/features/home/dashboard-status-client';
      const fixture=window.__statusFixture={requests:[],refreshes:0,realtime:{},stationRequests:[]};
      window.fetch=(url,options)=>new Promise((resolve,reject)=>{
        if(!String(url).startsWith('/api/dashboard/status'))throw Error('Unexpected request');
        options.signal.addEventListener('abort',()=>reject(new DOMException('cancelled','AbortError')),{once:true});
        fixture.requests.push({signal:options.signal,finish:data=>resolve(new Response(JSON.stringify({...data,viewerId:fixture.viewerId}),{headers:{'Content-Type':'application/json'}}))});
      });
      const initialData=${JSON.stringify(makeData())};
      function App(){
        const [props,setProps]=React.useState({initialData:new URLSearchParams(location.search).has('empty')?null:initialData,viewerId:'owner-a',initialDataAt:Date.now()});
        const [mounted,setMounted]=React.useState(true);
        fixture.render=(initialData,viewerId='owner-a',initialDataAt=Date.now())=>{setProps({initialData,viewerId,initialDataAt});setMounted(true)};fixture.viewerId=props.viewerId;
        fixture.unmount=()=>setMounted(false);
        return mounted?<DashboardStatusClient {...props} title="접수 현황" tabs={[]}/>:<p>Left page</p>;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env": '{"NODE_ENV":"production"}' },
    plugins: [{ name: "isolated-status-navigation", setup(builder) {
      builder.onResolve({ filter: /^(next\/(?:navigation|image|link)|@\/lib\/supabase\/client)$/ }, args => ({ path: args.path, namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ loader: "tsx", resolveDir: process.cwd(), contents:
        args.path === "next/navigation" ? `const router={refresh(){window.__statusFixture.refreshes++}};export const useRouter=()=>router;export const usePathname=()=>'/mypage';` :
        args.path === "next/link" ? `export default function Link({prefetch,replace,scroll,...props}){return <a {...props}/>}` :
        args.path === "next/image" ? `export default function Image({unoptimized,fill,priority,...props}){return <img {...props}/>}` :
        `const client={channel(){const channel={on(event,filter,callback){window.__statusFixture.realtime[filter.table]=callback;return channel},subscribe(){return channel}};return channel},removeChannel(){},from(){const query={select(){return query},eq(){return query},order(){return new Promise(resolve=>window.__statusFixture.stationRequests.push({finish:rows=>resolve({data:rows,error:null})}))}};return query}};export const createClient=()=>client;`
      }));
    } }],
  });
  html = `<!doctype html><html><body><div id="root"></div><script>${bundle.outputFiles[0].text.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
});

test.beforeEach(async ({ page }) => {
  await page.route("**/*", route => route.request().resourceType() === "document"
    ? route.fulfill({ contentType: "text/html", body: html }) : route.fulfill({ status: 404 }));
});
const count = (page: Page) => page.evaluate(() => (window as unknown as { __statusFixture: Fixture }).__statusFixture.requests.length);
const update = (page: Page, data: DashboardStatusData | null, viewerId = "owner-a", initialDataAt?: number) => page.evaluate(({ data, viewerId, initialDataAt }) => {
  (window as unknown as { __statusFixture: Fixture }).__statusFixture.render(data, viewerId, initialDataAt);
}, { data, viewerId, initialDataAt });
const finish = (page: Page, data: DashboardStatusData, index = 0) => page.evaluate(({ data, index }) => {
  (window as unknown as { __statusFixture: Fixture }).__statusFixture.requests[index].finish(data);
}, { data, index });
const visibility = (page: Page, state: "visible" | "hidden") => page.evaluate((state) => {
  Object.defineProperty(document, "visibilityState", { configurable: true, value: state });
  document.dispatchEvent(new Event("visibilitychange"));
}, state);

test("server data renders without a second fetch and refreshed rows preserve the selected submission", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/__status-performance");
  const detail = page.getByRole("link", { name: "자세히 보기", exact: true });
  await expect(detail).toHaveAttribute("href", "/dashboard/submissions/first");
  expect(await count(page)).toBe(0);
  await page.getByRole("button", { name: "다음 접수", exact: true }).click();
  await expect(detail).toHaveAttribute("href", "/dashboard/submissions/second");
  await update(page, makeData(["new", "first", "second"], "APPROVED", "2026-10-28T01:00:00Z"));
  await expect(detail).toHaveAttribute("href", "/dashboard/submissions/second");
  await expect(page.getByRole("progressbar", { name: "심의 완료율" })).toHaveAttribute("aria-valuenow", "100");
  await expect(page.getByText("3/3 · 진행중 3건", { exact: true })).toBeVisible();
  expect(await count(page)).toBe(0);
  expect(errors).toEqual([]);
});

test("hidden pages do not poll; focus events coalesce and leaving aborts outstanding work", async ({ page }) => {
  await page.clock.install();
  await page.goto("/__status-performance");
  await expect(page.getByRole("link", { name: "자세히 보기" })).toBeVisible();
  await visibility(page, "hidden");
  await page.clock.runFor(30_100);
  expect(await count(page)).toBe(0);
  await visibility(page, "visible");
  await expect.poll(() => count(page)).toBe(1);
  await page.evaluate(() => { window.dispatchEvent(new Event("focus")); window.dispatchEvent(new Event("focus")); });
  expect(await count(page)).toBe(1);
  await finish(page, makeData(["first", "second"], "APPROVED", "2026-10-28T01:00:00Z"));
  await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  await page.clock.runFor(15_100);
  await expect.poll(() => count(page)).toBe(2);
  await page.evaluate(() => (window as unknown as { __statusFixture: Fixture }).__statusFixture.unmount());
  await expect(page.getByText("Left page", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __statusFixture: Fixture }).__statusFixture.requests[1].signal.aborted)).toBe(true);
  await page.clock.runFor(45_000);
  expect(await count(page)).toBe(2);
});

test("a different account never sees the previous account's snapshot while loading", async ({ page }) => {
  await page.goto("/__status-performance");
  await expect(page.getByRole("link", { name: "자세히 보기" })).toHaveAttribute("href", "/dashboard/submissions/first");
  await update(page, null, "owner-b");
  await expect(page.getByRole("link", { name: "자세히 보기" })).toHaveCount(0);
  await expect.poll(() => count(page)).toBe(1);
  await finish(page, makeData(["other-owner"]));
  await expect(page.getByRole("link", { name: "자세히 보기" })).toHaveAttribute("href", "/dashboard/submissions/other-owner");
});

test("an interrupted first load is cancelled and returning can retry immediately", async ({ page }) => {
  await page.goto("/__status-performance?empty=1");
  await expect.poll(() => count(page)).toBe(1);
  await page.evaluate(() => (window as unknown as { __statusFixture: Fixture }).__statusFixture.unmount());
  await expect(page.getByText("Left page", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __statusFixture: Fixture }).__statusFixture.requests[0].signal.aborted)).toBe(true);
  await update(page, null);
  await expect.poll(() => count(page)).toBe(2);
  await finish(page, makeData(["returned"]), 1);
  await expect(page.getByRole("link", { name: "자세히 보기" })).toHaveAttribute("href", "/dashboard/submissions/returned");
});

test("an older restored server snapshot stays visible while a fresh request updates it", async ({ page }) => {
  await page.clock.install();
  await page.goto("/__status-performance");
  const detail = page.getByRole("link", { name: "자세히 보기" });
  await expect(detail).toHaveAttribute("href", "/dashboard/submissions/first");
  const receivedAt = await page.evaluate(() => Date.now());
  await page.evaluate(() => (window as unknown as { __statusFixture: Fixture }).__statusFixture.unmount());
  await expect(page.getByText("Left page", { exact: true })).toBeVisible();
  await page.clock.runFor(6_000);
  await update(page, makeData(), "owner-a", receivedAt);
  await expect(detail).toHaveAttribute("href", "/dashboard/submissions/first");
  await expect.poll(() => count(page)).toBe(1);
  await finish(page, makeData(["first", "second"], "APPROVED", "2026-10-28T01:00:00Z"));
  await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
});

test("a cross-tab account mismatch clears private content and revalidates authentication once", async ({ page }) => {
  await page.clock.install();
  await page.goto("/__status-performance");
  await expect(page.getByRole("link", { name: "자세히 보기" })).toBeVisible();
  await page.clock.runFor(15_100);
  await expect.poll(() => count(page)).toBe(1);
  await page.evaluate(() => { (window as unknown as { __statusFixture: Fixture }).__statusFixture.viewerId = "other-account"; });
  await finish(page, makeData(["private-other-account"]));
  await expect(page.getByRole("link", { name: "자세히 보기" })).toHaveCount(0);
  await expect(page.getByText("로그인 정보가 변경되어 다시 확인하고 있습니다.", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __statusFixture: Fixture }).__statusFixture.refreshes)).toBe(1);
  await page.clock.runFor(45_000);
  expect(await count(page)).toBe(1);
});

test("a late realtime lookup cannot overwrite a newer server result", async ({ page }) => {
  await page.goto("/__status-performance");
  await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
  await page.evaluate(() => { void (window as unknown as { __statusFixture: Fixture }).__statusFixture.realtime.station_reviews(); });
  await update(page, makeData(["first", "second"], "APPROVED", "2026-10-28T01:00:00Z"));
  await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  await page.evaluate((rows) => {
    (window as unknown as { __statusFixture: Fixture }).__statusFixture.stationRequests[0].finish(rows);
  }, makeData().albumStationsMap.first);
  await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  const placeholders = makeData();
  placeholders.albumStationsMap.first[0].id = "placeholder-first-kbs";
  await update(page, placeholders);
  await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
});
