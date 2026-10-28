import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { build } from "esbuild";

type Query = { table: string; columns: string; filters: Array<[string, ...unknown[]]> };
type Result = { data: unknown; error: { code?: string; message: string } | null };
type Fixture = {
  calls: Query[];
  query: (query: Query) => Promise<Result>;
};

async function fixture() {
  const bundled = await build({
    stdin: { contents: `export * from './src/lib/dashboard-status'; export {fixture} from 'status-fixture';`, resolveDir: process.cwd(), loader: "ts" },
    bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
    plugins: [{ name: "status-fixture", setup(plugin) {
      plugin.onResolve({ filter: /^(status-fixture|@\/lib\/supabase\/admin)$/ }, ({ path }) => ({ path, namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ loader: "js", contents: path === "status-fixture"
        ? `export const fixture={calls:[],query:async()=>({data:[],error:null})};`
        : `import {fixture} from 'status-fixture';export const createAdminClient=()=>({from(table){const request={table,columns:'',filters:[]};const q={select(columns){request.columns=columns;return q},then(resolve,reject){fixture.calls.push(request);return fixture.query(request).then(resolve,reject)}};for(const method of ['eq','in','is','not','or','gte','order','range'])q[method]=(...args)=>{request.filters.push([method,...args]);return q};return q;}});` }));
    } }],
  });
  const mod = { exports: {} as {
    fixture: Fixture;
    getDashboardStatusData: typeof import("../src/lib/dashboard-status").getDashboardStatusData;
    clearDashboardStatusCache: (userId: string) => void;
  } };
  new Function("require", "module", "exports", bundled.outputFiles[0].text)(createRequire(import.meta.url), mod, mod.exports);
  return mod.exports;
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const ownerOf = (query: Query) => query.filters.find(([method, key]) => method === "eq" && key === "user_id")?.[2] as string;
const isAlbum = (query: Query) => query.filters.some(([method, key, value]) => method === "eq" && key === "type" && value === "ALBUM");
const row = (id: string, joined = true) => ({
  id, title: id, artist_name: "Artist", status: "IN_PROGRESS", payment_status: "PAID",
  created_at: "2026-10-28T00:00:00Z", updated_at: "2026-10-28T00:00:00Z", package_id: "package",
  package: joined ? { name: "기본", station_count: 3 } : null,
});

test("status starts package stations and reviews together and skips already joined packages", async () => {
  const h = await fixture();
  const release: Array<() => void> = [];
  h.fixture.query = async (query) => {
    if (query.table === "submissions") return { data: isAlbum(query) ? [row("album")] : [], error: null };
    await new Promise<void>((resolve) => release.push(resolve));
    return { data: [], error: null };
  };
  const request = h.getDashboardStatusData("owner-a");
  await tick();
  assert.deepEqual(h.fixture.calls.map((query) => query.table), ["submissions", "submissions", "package_stations", "station_reviews"]);
  assert.equal(release.length, 2, "the review query starts without waiting for package stations");
  for (const query of h.fixture.calls.filter((query) => query.table === "submissions")) {
    assert.equal(ownerOf(query), "owner-a");
    assert.ok(query.filters.some(([method, key, value]) => method === "is" && key === "user_deleted_at" && value === null));
  }
  release.forEach((done) => done());
  assert.equal((await request).data?.albumSubmissions[0].id, "album");
  assert.equal(h.fixture.calls.length, 4, "successful joined data needs four queries instead of five");
});

test("simultaneous reads coalesce only for the same verified owner", async () => {
  const h = await fixture();
  const release: Array<() => void> = [];
  h.fixture.query = async (query) => {
    if (query.table !== "submissions") return { data: [], error: null };
    await new Promise<void>((resolve) => release.push(resolve));
    return { data: isAlbum(query) ? [row(ownerOf(query))] : [], error: null };
  };
  const requests = [h.getDashboardStatusData("owner-a"), h.getDashboardStatusData("owner-a"), h.getDashboardStatusData("owner-b")];
  await tick();
  assert.equal(h.fixture.calls.length, 4);
  release.forEach((done) => done());
  const results = await Promise.all(requests);
  assert.equal(results[0].data?.albumSubmissions[0].id, "owner-a");
  assert.deepEqual(results[0], results[1]);
  assert.equal(results[2].data?.albumSubmissions[0].id, "owner-b");
  const count = h.fixture.calls.length;
  await h.getDashboardStatusData("owner-a");
  assert.equal(h.fixture.calls.length, count, "warm owner cache avoids all DB queries");
});

test("an invalidated in-flight read cannot overwrite a later fresh result", async () => {
  const h = await fixture();
  const release: Array<() => void> = [];
  let version = "old";
  h.fixture.query = async (query) => {
    if (query.table !== "submissions") return { data: [], error: null };
    const snapshot = version;
    if (snapshot === "old") await new Promise<void>((resolve) => release.push(resolve));
    return { data: isAlbum(query) ? [row(snapshot)] : [], error: null };
  };
  const oldRequest = h.getDashboardStatusData("owner");
  await tick();
  h.clearDashboardStatusCache("owner");
  version = "new";
  assert.equal((await h.getDashboardStatusData("owner")).data?.albumSubmissions[0].id, "new");
  release.forEach((done) => done());
  await oldRequest;
  assert.equal((await h.getDashboardStatusData("owner")).data?.albumSubmissions[0].id, "new");
});

test("explicit refresh supersedes an older ordinary read and coalesces refresh requests", async () => {
  const h = await fixture();
  const release: Array<() => void> = [];
  let version = "old";
  h.fixture.query = async (query) => {
    if (query.table !== "submissions") return { data: [], error: null };
    const snapshot = version;
    await new Promise<void>((resolve) => release.push(resolve));
    return { data: isAlbum(query) ? [row(snapshot)] : [], error: null };
  };
  const oldRequest = h.getDashboardStatusData("owner");
  await tick();
  version = "new";
  const freshRequests = [h.getDashboardStatusData("owner", { bypassCache: true }), h.getDashboardStatusData("owner", { bypassCache: true })];
  await tick();
  assert.equal(release.length, 4, "two refresh callers share one new pair of submission queries");
  release.slice(2).forEach((done) => done());
  const fresh = await Promise.all(freshRequests);
  assert.equal(fresh[0].data?.albumSubmissions[0].id, "new");
  release.slice(0, 2).forEach((done) => done());
  await oldRequest;
  assert.equal((await h.getDashboardStatusData("owner")).data?.albumSubmissions[0].id, "new");
});

test("missing package joins retain the metadata fallback", async () => {
  const h = await fixture();
  h.fixture.query = async (query) => ({
    data: query.table === "submissions" && isAlbum(query) ? [row("album", false)]
      : query.table === "packages" ? [{ id: "package", name: "기본", station_count: 3 }] : [],
    error: null,
  });
  const result = await h.getDashboardStatusData("owner");
  assert.ok(h.fixture.calls.some((query) => query.table === "packages"));
  assert.equal(result.data?.albumStationsMap.album.length, 3);
});

test("finished user caches stay bounded and failed reads can retry", async () => {
  const h = await fixture();
  for (let i = 0; i < 101; i += 1) await h.getDashboardStatusData(`owner-${i}`);
  const count = h.fixture.calls.length;
  await h.getDashboardStatusData("owner-100");
  assert.equal(h.fixture.calls.length, count);
  await h.getDashboardStatusData("owner-0");
  assert.equal(h.fixture.calls.length, count + 2, "the oldest entry was evicted");

  h.fixture.query = async () => ({ data: null, error: { code: "08006", message: "temporary connection failure" } });
  assert.ok((await h.getDashboardStatusData("retry-owner")).error);
  h.fixture.query = async () => ({ data: [], error: null });
  assert.ok((await h.getDashboardStatusData("retry-owner")).data);
});

type ElementTree = { type: unknown; props: Record<string, unknown> & { children?: ElementTree; fallback?: ElementTree } };

async function pageFixture() {
  const bundle = await build({
    stdin: { contents: `export {StatusPageView} from './src/app/dashboard/view'; export {state,calls} from 'page-fixture';`, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, platform: "node", format: "cjs", packages: "external", write: false, jsx: "automatic",
    plugins: [{ name: "page-fixture", setup(plugin) {
      plugin.onResolve({ filter: /^(page-fixture|next\/navigation|@\/lib\/(dashboard-status|supabase\/(server|server-user))|@\/features\/home\/dashboard-status-client|@\/components\/dashboard\/(dashboard-shell|review-page-loading))$/ }, ({ path }) => ({ path, namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ loader: "js", contents: ({
        "page-fixture": `export const state={user:{id:'verified-owner'},result:Promise.resolve({data:null})};export const calls=[];`,
        "next/navigation": `export const redirect=path=>{throw Error('redirect:'+path)};`,
        "@/lib/supabase/server": `export const createServerSupabase=async()=>({});`,
        "@/lib/supabase/server-user": `import {state,calls} from 'page-fixture';export const getServerSessionUser=async()=>{calls.push(['auth']);return state.user};`,
        "@/lib/dashboard-status": `import {state,calls} from 'page-fixture';export const getDashboardStatusData=(...args)=>{calls.push(['status',...args]);return state.result};`,
        "@/features/home/dashboard-status-client": `export const DashboardStatusClient=()=>null;`,
        "@/components/dashboard/dashboard-shell": `export const DashboardShell=()=>null;export const statusDashboardTabs=[];`,
        "@/components/dashboard/review-page-loading": `export const ReviewPageLoading=()=>null;`,
      } as Record<string, string>)[path] }));
    } }],
  });
  const mod = { exports: {} as {
    StatusPageView: (config?: { loginPath?: string; forceStatusRefresh?: boolean }) => Promise<ElementTree>;
    state: { user: { id: string } | null; result: Promise<unknown> };
    calls: unknown[][];
  } };
  new Function("require", "module", "exports", bundle.outputFiles[0].text)(createRequire(import.meta.url), mod, mod.exports);
  return mod.exports;
}

test("status streams its shell before DB resolves and seeds the client after one auth check", { timeout: 2000 }, async () => {
  const h = await pageFixture();
  let finish!: (result: unknown) => void;
  h.state.result = new Promise((resolve) => { finish = resolve; });
  const page = await h.StatusPageView({ forceStatusRefresh: true });
  assert.equal(page.type, Symbol.for("react.suspense"));
  assert.ok(page.props.fallback, "a visible shell is ready while DB work is pending");
  assert.deepEqual(h.calls, [["auth"], ["status", "verified-owner", { bypassCache: true }]]);
  const child = page.props.children!;
  const renderStatus = child.type as (props: Record<string, unknown>) => Promise<ElementTree>;
  const response = renderStatus(child.props);
  const data = { albumSubmissions: [row("verified-owner")], mvSubmissions: [], albumStationsMap: {}, mvStationsMap: {} };
  finish({ data });
  const client = await response;
  assert.equal(client.props.viewerId, "verified-owner");
  assert.deepEqual(client.props.initialData, data);
  assert.ok(typeof client.props.initialDataAt === "number" && client.props.initialDataAt <= Date.now());
  assert.equal(h.calls.length, 2, "no second auth or API request is used to obtain the initial data");
});

test("status never starts a privileged data query before user verification", async () => {
  const h = await pageFixture();
  h.state.user = null;
  await assert.rejects(h.StatusPageView({ loginPath: "/en/login" }), /redirect:\/en\/login/);
  assert.deepEqual(h.calls, [["auth"]]);
});
