import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { build } from "esbuild";

const submissionId = "11111111-1111-4111-8111-111111111111";
const certificateKey = `submissions/${submissionId}/certificate/current.pdf`;
const supabaseUrl = "https://project.supabase.co";
const publicMv = `${supabaseUrl}/storage/v1/object/public/mv`;

type Handler = (request: Request, context?: { params: Promise<{ id: string }> }) => Promise<Response>;
type Call = { kind: string; key?: string; url?: string; bucket?: string; paths?: string[]; path?: string; value?: unknown };
type Fixture = {
  certificate: Handler; ratingImage: Handler; guide: Handler; legacy: Handler;
  adminAssets: { POST: Handler; DELETE: Handler };
  managedRatingImageStoragePath: (objectKey?: string | null) => string | null;
  state: { isAdmin: boolean; settings: unknown; submission: Record<string, unknown> };
  calls: Call[];
};

async function fixture(): Promise<Fixture> {
  process.env.NEXT_PUBLIC_SUPABASE_URL = supabaseUrl;
  delete process.env.SUPABASE_URL;
  process.env.NEXT_PUBLIC_SITE_URL = "https://iamonside.com";
  const bundle = await build({
    stdin: {
      contents: [
        "export {GET as certificate} from './src/app/api/submissions/[id]/mv-certificate/route';",
        "export {GET as ratingImage} from './src/app/api/submissions/[id]/mv-rating-image/route';",
        "export {GET as guide} from './src/app/api/submissions/[id]/mv-guide/route';",
        "export {GET as legacy} from './src/app/api/b2/download/route';",
        "export * as adminAssets from './src/app/api/admin/mv-rating-assets/route';",
        "export {managedRatingImageStoragePath} from './src/lib/mv-assets';",
        "export {state,calls} from 'mv-result-fixture';",
      ].join("\n"),
      resolveDir: process.cwd(),
      loader: "ts",
    },
    bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
    plugins: [{ name: "mv-result-fixture", setup(plugin) {
      plugin.onResolve({ filter: /^(mv-result-fixture|@\/lib\/(?:b2|download-response|payments\/submission|supabase\/server|supabase\/admin))$/ }, args => ({ path: args.path, namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => {
        const shared = "import {state,calls} from 'mv-result-fixture';";
        const modules: Record<string, string> = {
          "mv-result-fixture": `export const state={isAdmin:true,settings:null,submission:{id:'${submissionId}',type:'MV_DISTRIBUTION',status:'RESULT_READY',result_status:'APPROVED',result_notified_at:null,mv_desired_rating:'15',certificate_b2_path:'${certificateKey}',certificate_original_name:'current.pdf',certificate_mime:'application/pdf'}};export const calls=[];`,
          "@/lib/payments/submission": `${shared} export const ensureSubmissionOwner=async()=>({submission:state.submission,error:null});`,
          "@/lib/supabase/server": `${shared} export const createServerSupabase=async()=>({auth:{getUser:async()=>({data:{user:{id:'admin'}}})},rpc:async()=>({data:state.isAdmin})});`,
          "@/lib/supabase/admin": `${shared} export const createAdminClient=()=>({
            from(){const chain={select(){return chain},eq(){return chain},maybeSingle:async()=>({data:state.settings?{value:state.settings}:null,error:null}),upsert:async(row)=>{calls.push({kind:'settings',value:row.value});state.settings=row.value;return {error:null}}};return chain},
            storage:{from(bucket){return {
              upload:async(path)=>{calls.push({kind:'upload',bucket,path});return {error:null}},
              remove:async(paths)=>{calls.push({kind:'remove',bucket,paths});return {error:null}},
              getPublicUrl:(path)=>({data:{publicUrl:'${supabaseUrl}/storage/v1/object/public/'+bucket+'/'+path}}),
            }}},
          });`,
          "@/lib/b2": `${shared} export class B2ConfigError extends Error{};export const getB2Config=()=>({prefix:'submissions/',bucket:'fixture'});export const headObject=async(key)=>{calls.push({kind:'head',key});return{}};export const presignGetUrl=async(key)=>{calls.push({kind:'sign',key});return 'https://fixture.invalid/signed'};export const deleteObject=async(key)=>{calls.push({kind:'b2-delete',key})};export const sanitizeFileName=name=>name;`,
          "@/lib/download-response": `${shared} export const createAttachmentResponseFromUrl=async({url})=>{calls.push({kind:'fetch',url});return new Response('file')};`,
        };
        return { loader: "js", contents: modules[path] };
      });
    } }],
  });
  const output = { exports: {} as Fixture };
  new Function("require", "module", "exports", bundle.outputFiles[0].text)(createRequire(import.meta.url), output, output.exports);
  return output.exports;
}

const context = { params: Promise.resolve({ id: submissionId }) };
const get = (path: string) => new Request(`https://iamonside.com${path}`);
const fileCalls = (api: Fixture) => api.calls.filter(call => ["sign", "fetch", "head"].includes(call.kind));

test("an approved online music video hands out the rating mark, certificate and usage guide", async () => {
  const api = await fixture();
  assert.equal((await api.ratingImage(get("/rating"), context)).status, 200);
  assert.equal((await api.certificate(get("/certificate"), context)).status, 200);
  assert.equal((await api.guide(get("/guide"), context)).status, 200);
  assert.equal((await api.legacy(get(`/api/b2/download?filePath=${encodeURIComponent(certificateKey)}`))).status, 302);
  const fetched = api.calls.filter(call => call.kind === "fetch").map(call => call.url);
  assert.equal(fetched[0], "https://iamonside.com/media/mv-ratings/15.png");
  assert.equal(fetched[1], "https://fixture.invalid/signed");
  assert.match(fetched[2] ?? "", /\/storage\/v1\/object\/public\/mv\/mv_guide\.pdf$/);
});

test("a rejected online music video hands out no files from any customer route", async () => {
  const api = await fixture();
  api.state.submission.mv_desired_rating = "REJECT";
  api.state.submission.result_status = "REJECTED";
  for (const response of [
    await api.ratingImage(get("/rating"), context),
    await api.certificate(get("/certificate"), context),
    await api.guide(get("/guide"), context),
    await api.legacy(get(`/api/b2/download?filePath=${encodeURIComponent(certificateKey)}`)),
  ]) {
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error, "심의 불가 결과에는 제공되는 파일이 없습니다.");
  }
  assert.deepEqual(fileCalls(api), []);
});

test("replacement rating marks are stored in Supabase Storage, never under the B2 customer prefix", async () => {
  const api = await fixture();
  const upload = async (name: string) => {
    const form = new FormData();
    form.set("rating", "ALL");
    form.set("file", new File([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])], name, { type: "image/png" }));
    return api.adminAssets.POST(new Request("https://iamonside.com/api/admin/mv-rating-assets", { method: "POST", body: form }));
  };

  assert.equal((await upload("전체 관람가.png")).status, 200);
  const first = api.calls.find(call => call.kind === "upload");
  assert.equal(first?.bucket, "mv");
  assert.match(first?.path ?? "", /^rating-images\/ALL\/\d+\.png$/);
  const saved = (api.state.settings as { images: Record<string, { objectKey: string; originalName: string }> }).images.ALL;
  assert.equal(saved.objectKey, `${publicMv}/${first?.path}`);
  assert.equal(saved.originalName, "전체 관람가.png");
  assert.equal(api.calls.some(call => call.kind === "b2-delete"), false);

  // Replacing removes the previous Supabase object; a pre-move B2 key is
  // still cleaned up in B2; the shared usage guide is never touched.
  await new Promise(resolve => setTimeout(resolve, 2));
  assert.equal((await upload("new.png")).status, 200);
  assert.deepEqual(api.calls.filter(call => call.kind === "remove").map(call => call.paths), [[first?.path]]);
  (api.state.settings as { images: Record<string, { objectKey: string }> }).images.ALL.objectKey = "submissions/admin-mv-rating-images/ALL/old.png";
  const removeAll = () => api.adminAssets.DELETE(new Request("https://iamonside.com/api/admin/mv-rating-assets", { method: "DELETE", body: JSON.stringify({ rating: "ALL" }) }));
  assert.equal((await removeAll()).status, 200);
  assert.deepEqual(api.calls.filter(call => call.kind === "b2-delete").map(call => call.key), ["submissions/admin-mv-rating-images/ALL/old.png"]);
  (api.state.settings as { images: Record<string, { objectKey: string }> }).images = { ALL: { objectKey: `${publicMv}/mv_guide.pdf` } };
  const removals = api.calls.filter(call => call.kind === "remove").length;
  assert.equal((await removeAll()).status, 200);
  assert.equal(api.calls.filter(call => call.kind === "remove").length, removals);
});

test("only marks this app uploaded to the mv bucket count as removable storage paths", async () => {
  const api = await fixture();
  assert.equal(api.managedRatingImageStoragePath(`${publicMv}/rating-images/ALL/1.png`), "rating-images/ALL/1.png");
  for (const objectKey of [
    `${publicMv}/mv_guide.pdf`,
    `${publicMv}/rating-images/ALL/../../mv_guide.pdf`,
    `${publicMv}/rating-images/ALL/%2E%2E/%2E%2E/mv_guide.pdf`,
    `${publicMv}/rating-images/ALL/1.png?download=1`,
    `${supabaseUrl}/storage/v1/object/public/banners/rating-images/ALL/1.png`,
    "https://other.supabase.co/storage/v1/object/public/mv/rating-images/ALL/1.png",
    "/media/mv-ratings/all.png",
    "submissions/admin-mv-rating-images/ALL/1.png",
    null,
  ]) {
    assert.equal(api.managedRatingImageStoragePath(objectKey), null, String(objectKey));
  }
});
