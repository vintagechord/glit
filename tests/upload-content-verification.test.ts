import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { inspectFileSignature } from "../src/lib/file-signature";

const text = (value: string) => new TextEncoder().encode(value);
test("known upload containers reject renamed contents without treating header checks as full validation", () => {
  const fixtures: Array<[string, Uint8Array]> = [
    ["wave.wav", text("RIFF1234WAVEdata")], ["broadcast.wav", text("RF64ffffWAVEdata")],
    ["audio.mp3", text("ID3fixture")], ["legacy.doc", text(" {\\rtf1 original document}")],
    ["form.doc", Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])],
    ["form.hwp", Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])],
    ["archive.zip", Uint8Array.from([0x50, 0x4b, 3, 4])], ["form.docx", Uint8Array.from([0x50, 0x4b, 3, 4])],
    ["proof.pdf", text("\n%PDF-1.7")], ["movie.mov", text("0000moovmovie")], ["movie.mp4", text("0000ftypisom")],
    ["movie.m4v", text("0000ftypisom")], ["movie.mxf", Uint8Array.from([6, 0x0e, 0x2b, 0x34])],
    ["movie.wmv", Uint8Array.from([0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11])],
    ["movie.mpg", Uint8Array.from([0, 0, 1, 0xba])], ["movie.mpeg", Uint8Array.from([0, 0, 1, 0xb3])],
    ["proof.jpg", Uint8Array.from([0xff, 0xd8, 0xff])], ["proof.jpeg", Uint8Array.from([0xff, 0xd8, 0xff])],
    ["proof.png", Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
    ["proof.webp", text("RIFF1234WEBPdata")], ["가사.txt", text(" \n한글 가사입니다.\n")],
    ["가사.lrc", Uint8Array.from([0xff, 0xfe, 0x41, 0, 0x42, 0])],
  ];
  for (const [filename, bytes] of fixtures) {
    assert.equal(inspectFileSignature(filename, bytes), "matched", filename);
    assert.equal(inspectFileSignature(filename, Uint8Array.from([0, 0, 0, 0])), "mismatch", filename);
  }
  assert.equal(inspectFileSignature("renamed.wav", text("%PDF-1.7")), "mismatch");
  assert.equal(inspectFileSignature("legacy.mkv", Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3])), "unsupported");
});

test("both completion endpoints verify bounded bytes before staging and retain safe legacy behavior", async () => {
  const bundle = await build({ stdin: { contents: "export {POST as direct} from './src/app/api/uploads/complete/route'; export {POST as multipart} from './src/app/api/uploads/multipart/complete/route'; export {state,calls} from 'content-fixture';", resolveDir: process.cwd(), loader: "ts" }, bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
    plugins: [{ name: "upload-content-fixture", setup(plugin) {
      plugin.onResolve({ filter: /^(content-fixture|@\/lib\/(?:b2|supabase\/admin|payments\/submission|multipart-upload-grants|request-rate-limit|submission-object-key))$/ }, args => ({ path: args.path, namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => {
        const shared = "import {state,calls} from 'content-fixture';";
        const modules: Record<string, string> = {
          "content-fixture": `export const state={bytes:new TextEncoder().encode('RIFF1234WAVEdata'),filename:'fixture.wav',rangeLength:null,ownerError:null,sizeOverride:null}; export const calls=[];`,
          "@/lib/b2": `${shared} export class B2ConfigError extends Error{}; export const getB2Config=()=>({prefix:'submissions/',bucket:'fixture',client:{send:async command=>{calls.push({name:command.constructor.name,input:command.input});if(command.constructor.name==='HeadObjectCommand')return {ContentLength:state.bytes.length,ETag:'fixture-etag'};return {ContentLength:state.rangeLength??state.bytes.length,Body:{transformToWebStream:()=>new ReadableStream({pull(controller){calls.push({name:'read'});controller.enqueue(state.bytes);controller.close()},cancel(){calls.push({name:'cancel'})}})}}}}});export const deleteObject=async()=>{calls.push({name:'delete'})};export const presignGetUrl=async()=> 'https://fixture.invalid/download';export const completeMultipartUpload=async()=>{calls.push({name:'complete'})};`,
          "@/lib/payments/submission": `${shared} export const ensureSubmissionOwner=async()=>({user:{id:'fixture-user'},submission:{id:'fixture',user_id:'fixture-user',status:'DRAFT',payment_status:'UNPAID',current_order_id:null},error:state.ownerError});`,
          "@/lib/submission-object-key": `export const isSubmissionObjectKeyOwned=()=>true;`,
          "@/lib/request-rate-limit": `export const consumeRateLimit=()=>({allowed:true});export const getRequestIdentifier=()=> 'fixture';`,
          "@/lib/supabase/admin": `${shared} export const createAdminClient=()=>({rpc:async()=>({data:"START",error:null}),from(table){const chain={upsert(payload){calls.push({name:'stage',table,payload});return chain},select(){return chain},async maybeSingle(){return {data:{id:'staging-fixture'},error:null}}};return chain}});`,
          "@/lib/multipart-upload-grants": `${shared} export const getMultipartOwnerKey=()=> 'user:fixture-user';export const getMultipartGrant=async()=>({id:'grant',status:'ACTIVE',expires_at:new Date(Date.now()+60000).toISOString(),declared_size_bytes:state.bytes.length,original_name:state.filename,mime_type:'audio/wav',upload_kind:'audio'});export const multipartGrantMatches=()=>true;export const abortExpiredMultipartGrant=async()=>{};export const abortCompletingMultipartGrant=async()=>{calls.push({name:'abort'})};export const markMultipartGrantCompleted=async()=>{calls.push({name:'completed'})};export const markMultipartGrantFailed=async()=>{calls.push({name:'failed'})};`,
        };
        return { loader: "js", contents: modules[path] };
      });
    } }],
  });
  type Route = (request: Request) => Promise<Response>;
  const output = { exports: {} as { direct: Route; multipart: Route; state: { bytes: Uint8Array; filename: string; rangeLength: number | null; ownerError: string | null; sizeOverride: number | null }; calls: Array<{ name: string; input?: { Range?: string }; payload?: { original_name?: string } }> } };
  new Function("require", "module", "exports", bundle.outputFiles[0].text)(createRequire(import.meta.url), output, output.exports);
  const api = output.exports;
  const id = "11111111-1111-4111-8111-111111111111";
  function request(legacy = false) {
    const key = `submissions/fixture/${api.state.filename}`;
    return new Request("https://fixture.invalid/api/uploads/complete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ submissionId: id, grantId: id, uploadId: "fixture-upload", parts: [{ partNumber: 1, etag: "fixture-etag" }], ...(legacy ? { objectKey: key } : { key, filename: api.state.filename }), kind: "AUDIO", mimeType: "audio/wav", sizeBytes: api.state.sizeOverride ?? api.state.bytes.length }) });
  }
  for (const route of [api.direct, api.multipart]) {
    api.calls.length = 0; api.state.bytes = text("RIFF1234WAVEdata"); api.state.filename = "fixture.wav";
    let response = await route(request());
    assert.equal(response.status, 200);
    let body = await response.json();
    assert.equal(body.verified, true); assert.deepEqual(body.verification, { size: true, signature: "matched", codec: "not_checked", contents: "not_checked" });
    assert.equal(api.calls.find(call => call.name === "GetObjectCommand")?.input?.Range, "bytes=0-1023");
    assert.ok(api.calls.findIndex(call => call.name === "read") < api.calls.findIndex(call => call.name === "stage"));

    api.calls.length = 0; api.state.bytes = text("%PDF-1.7 renamed as waveform");
    response = await route(request());
    assert.equal(response.status, 400); body = await response.json();
    assert.match(body.error, /파일 내용과 확장자/); assert.equal(body.verified, undefined);
    assert.equal(api.calls.some(call => call.name === "stage"), false);

    api.calls.length = 0; api.state.filename = "legacy.mkv";
    response = await route(request());
    assert.equal(response.status, 200); body = await response.json();
    assert.equal(body.verified, false); assert.equal(body.verification.signature, "unsupported");
    assert.equal(api.calls.some(call => call.name === "GetObjectCommand"), false);

    api.calls.length = 0; api.state.filename = "fixture.wav"; api.state.rangeLength = 4 * 1024 ** 3;
    response = await route(request());
    assert.equal(response.status, 500); assert.equal(api.calls.some(call => call.name === "stage"), false);
    assert.equal(api.calls.some(call => call.name === "read"), false, "reject a provider ignoring Range before consuming bytes");
    api.state.rangeLength = null;

    api.calls.length = 0; api.state.ownerError = "FORBIDDEN";
    response = await route(request());
    assert.equal(response.status, 403); assert.equal(api.calls.some(call => call.name === "GetObjectCommand"), false);
    api.state.ownerError = null;
  }
  api.calls.length = 0; api.state.bytes = text("RIFF1234WAVEdata"); api.state.filename = "legacy.wav";
  api.state.sizeOverride = api.state.bytes.length + 1;
  const mismatch = await api.direct(request());
  assert.equal(mismatch.status, 400);
  assert.equal(api.calls.some(call => call.name === "delete"), false, "incorrect request metadata must not delete a previously staged/live object");
  assert.equal(api.calls.some(call => call.name === "stage"), false);
  api.state.sizeOverride = null;
  api.calls.length = 0;
  const legacy = await api.direct(request(true));
  assert.equal(legacy.status, 200);
  assert.equal(api.calls.find(call => call.name === "stage")?.payload?.original_name, "legacy.wav");
});
