import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { build } from "esbuild";

import {
  isAllowedKaraokeUpload,
  karaokeUploadAccept,
  knownDownloadContentType,
  type KaraokeUploadScope,
} from "../src/lib/upload-file-types";

type Fixture = {
  POST: (request: Request) => Promise<Response>;
  presigned: Array<{ objectKey: string; contentType?: string; contentLength?: number }>;
};

// The real route with storage, auth and rate limits replaced, as in
// translate-route.test.ts. No network or storage is touched.
async function fixture(): Promise<Fixture> {
  const stubs: Record<string, string> = {
    "presign-fixture": "export const presigned = [];",
    "@/lib/b2": `import { presigned } from "presign-fixture";
      export class B2ConfigError extends Error {}
      export const buildObjectKey = ({ userId, submissionId, filename }) => \`submissions/\${userId}/\${submissionId}/\${filename}\`;
      export const getB2Config = () => ({ signExpiry: 900 });
      export const presignPutUrl = async (params) => { presigned.push(params); return "https://storage.fixture.invalid/put"; };`,
    "@/lib/supabase/server": `export const createServerSupabase = async () => ({ auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) } });`,
    "@/lib/request-rate-limit": `export const consumeRateLimit = () => ({ allowed: true, retryAfterSeconds: 0 }); export const getRequestIdentifier = () => "fixture";`,
  };
  const result = await build({
    stdin: { resolveDir: process.cwd(), loader: "ts", contents: "export { POST } from './src/app/api/uploads/presign/route'; export { presigned } from 'presign-fixture';" },
    bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
    plugins: [{ name: "presign-route-fixture", setup(plugin) {
      plugin.onResolve({ filter: /^(presign-fixture|@\/lib\/(?:b2|supabase\/server|request-rate-limit))$/ }, (args) => ({ path: args.path, namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ loader: "js", contents: stubs[path] }));
    } }],
  });
  const output = { exports: {} as Fixture };
  new Function("require", "module", "exports", result.outputFiles[0].text)(createRequire(import.meta.url), output, output.exports);
  return output.exports;
}

const presign = (api: Fixture, scope: KaraokeUploadScope, filename: string, mimeType: string) =>
  api.POST(new Request("https://fixture.invalid/api/uploads/presign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ submissionId: "00000000-0000-4000-8000-000000000001", filename, mimeType, sizeBytes: 1024, scope }),
  }));

test("karaoke presign signs only allowlisted files whose declared type fits the extension", async () => {
  const api = await fixture();
  const allowed: Array<[KaraokeUploadScope, string, string]> = [
    ["karaoke_request", "노래.mp3", "audio/mpeg"], ["karaoke_request", "가이드.wav", "audio/wav"],
    ["karaoke_request", "voice.m4a", "audio/x-m4a"], ["karaoke_request", "master.flac", ""],
    ["karaoke_request", "가사.txt", "text/plain"], ["karaoke_request", "가사.hwp", "application/haansofthwp"],
    ["karaoke_request", "악보.pdf", "application/pdf"], ["karaoke_request", "자료.zip", "application/x-zip-compressed"],
    ["karaoke_request", "참고영상.mp4", "video/mp4"], ["karaoke_request", "가사.jpg", "image/jpeg"],
    ["karaoke_recommendation", "인증.png", "image/png"], ["karaoke_recommendation", "IMG_0001.HEIC", "image/heic"],
    ["karaoke_recommendation", "capture.jpeg", "application/octet-stream"],
  ];
  for (const [scope, filename, mime] of allowed) {
    const response = await presign(api, scope, filename, mime);
    assert.equal(response.status, 200, `${scope} ${filename} ${mime}`);
  }
  assert.equal(api.presigned.length, allowed.length);

  const refused: Array<[KaraokeUploadScope, string, string]> = [
    ["karaoke_request", "page.html", "text/html"], ["karaoke_request", "a.pdf", "text/html"],
    ["karaoke_request", "image.svg", "image/svg+xml"], ["karaoke_request", "run.exe", "application/octet-stream"],
    ["karaoke_request", "noextension", "audio/mpeg"], ["karaoke_request", "가사.txt", "text/html"],
    ["karaoke_request", "노래.mp3", "video/mp4"], ["karaoke_request", "script.js", "application/javascript"],
    ["karaoke_recommendation", "노래.mp3", "audio/mpeg"], ["karaoke_recommendation", "인증.pdf", "application/pdf"],
    ["karaoke_recommendation", "인증.png", "image/svg+xml"], ["karaoke_recommendation", "인증.svg", "image/svg+xml"],
  ];
  for (const [scope, filename, mime] of refused) {
    const response = await presign(api, scope, filename, mime);
    assert.equal(response.status, 400, `${scope} ${filename} ${mime}`);
    assert.match((await response.json()).error, /만 업로드할 수 있습니다/);
  }
  assert.equal(api.presigned.length, allowed.length, "a refused file is never signed");
});

test("the karaoke file pickers offer the same extensions the server accepts", () => {
  for (const scope of ["karaoke_request", "karaoke_recommendation"] as const) {
    for (const extension of karaokeUploadAccept(scope).split(",")) {
      assert.match(extension, /^\.[a-z0-9]+$/);
      assert.equal(isAllowedKaraokeUpload(scope, `file${extension}`, ""), true, `${scope} ${extension}`);
      assert.ok(knownDownloadContentType(`file${extension}`), `${extension} downloads with a known type`);
    }
  }
  assert.equal(isAllowedKaraokeUpload("karaoke_recommendation", "a.mp3", ""), false);
});
