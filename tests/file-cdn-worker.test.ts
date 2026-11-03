import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import test from "node:test";
import { SignatureV4 } from "@smithy/signature-v4";

import { encodeObjectKey, handle, signB2Request } from "../services/files-cdn/src/index.mjs";
import { getFileCdnConfig, signFileCdnUrl } from "../src/lib/file-cdn";

const secret = "fixture-signing-secret-at-least-32-characters";
const env = {
  B2_S3_ENDPOINT: "https://s3.us-west-004.backblazeb2.com", B2_REGION: "us-west-004", B2_BUCKET: "onside-fixture",
  B2_KEY_ID: "004fixturekeyid", B2_APPLICATION_KEY: "K004fixtureapplicationkey", FILES_SIGNING_SECRET: secret,
  ALLOWED_ORIGINS: "https://iamonside.com",
};
const cdn = { base: "https://onside-files.example.workers.dev", secret };
const key = "submissions/7d3c/트랙 01 (Hug)!.wav";
const now = Date.parse("2026-11-04T03:30:00Z");

class NodeSha256 {
  private hash;
  constructor(secretKey?: unknown) { this.hash = secretKey ? createHmac("sha256", Buffer.from(secretKey as Uint8Array)) : createHash("sha256"); }
  update(data: Uint8Array | string) { this.hash.update(data); }
  async digest() { return new Uint8Array(this.hash.digest()); }
  reset() { /* single use */ }
}

test("the Worker's SigV4 matches the AWS SDK signer for a non-ASCII key", async () => {
  const signedAt = new Date("2026-11-04T03:30:00Z");
  const ours = await signB2Request({ method: "GET", endpoint: env.B2_S3_ENDPOINT, region: env.B2_REGION, bucket: env.B2_BUCKET, key, accessKeyId: env.B2_KEY_ID, secretAccessKey: env.B2_APPLICATION_KEY, now: signedAt });
  const path = `/${env.B2_BUCKET}/${encodeObjectKey(key)}`;
  assert.equal(ours.url, `${env.B2_S3_ENDPOINT}${path}`);
  assert.match(path, /%ED%8A%B8%EB%9E%99%2001%20%28Hug%29%21\.wav$/);
  const reference = new SignatureV4({ service: "s3", region: env.B2_REGION, sha256: NodeSha256, uriEscapePath: false, applyChecksum: false,
    credentials: { accessKeyId: env.B2_KEY_ID, secretAccessKey: env.B2_APPLICATION_KEY } });
  const signed = await reference.sign({ method: "GET", protocol: "https:", hostname: "s3.us-west-004.backblazeb2.com", path, query: {},
    headers: { host: "s3.us-west-004.backblazeb2.com", "x-amz-content-sha256": "UNSIGNED-PAYLOAD" } }, { signingDate: signedAt });
  assert.equal(ours.headers.authorization, signed.headers.authorization);
  assert.equal(ours.headers["x-amz-date"], signed.headers["x-amz-date"]);
});

function upstream(calls: Array<{ url: string; init: RequestInit }>, response: () => Response): typeof fetch {
  return async (url: RequestInfo | URL, init?: RequestInit) => { calls.push({ url: String(url), init: init ?? {} }); return response(); };
}

test("a link signed by Onside streams the private object as an attachment and forwards ranges", async () => {
  const link = signFileCdnUrl(cdn, { objectKey: key, filename: "01.Hug.wav", contentType: "audio/wav", expiresInSeconds: 600, now });
  assert.match(link, /^https:\/\/onside-files\.example\.workers\.dev\/f\/[A-Za-z0-9_-]+\?e=\d+&n=[A-Za-z0-9_-]+&t=[A-Za-z0-9_-]+&s=[A-Za-z0-9_-]+$/);
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = upstream(calls, () => new Response("RIFF-partial", { status: 206, headers: { "content-type": "binary/octet-stream", "content-length": "12", "content-range": "bytes 0-11/34431340", etag: '"abc"' } }));
  const response = await handle(new Request(link, { headers: { range: "bytes=0-11", origin: "https://iamonside.com" } }), env, { now: now + 1000, fetchImpl });
  assert.equal(response.status, 206);
  assert.equal(await response.text(), "RIFF-partial");
  assert.equal(response.headers.get("content-type"), "audio/wav");
  assert.equal(response.headers.get("content-disposition"), `attachment; filename="01.Hug.wav"; filename*=UTF-8''01.Hug.wav`);
  assert.equal(response.headers.get("content-range"), "bytes 0-11/34431340");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("access-control-allow-origin"), "https://iamonside.com");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${env.B2_S3_ENDPOINT}/${env.B2_BUCKET}/${encodeObjectKey(key)}`);
  const headers = calls[0].init.headers as Record<string, string>;
  assert.match(headers.authorization, /^AWS4-HMAC-SHA256 Credential=004fixturekeyid\/20261104\/us-west-004\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[a-f0-9]{64}$/);
  assert.equal(headers.range, "bytes=0-11");
  assert.equal(calls[0].init.method, "GET");
});

test("tampered, expired, foreign-key and malformed links never reach storage", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = upstream(calls, () => new Response("x"));
  const link = new URL(signFileCdnUrl(cdn, { objectKey: key, filename: "01.Hug.wav", contentType: "audio/wav", expiresInSeconds: 600, now }));
  const other = new URL(signFileCdnUrl(cdn, { objectKey: "submissions/other.wav", filename: "01.Hug.wav", contentType: "audio/wav", expiresInSeconds: 600, now }));
  const swapped = new URL(link); swapped.pathname = other.pathname;
  const renamed = new URL(link); renamed.searchParams.set("n", Buffer.from("evil.html").toString("base64url"));
  const retyped = new URL(link); retyped.searchParams.set("t", Buffer.from("text/html").toString("base64url"));
  const forged = new URL(signFileCdnUrl({ ...cdn, secret: "another-secret-that-is-also-32-characters!" }, { objectKey: key, filename: "01.Hug.wav", contentType: "audio/wav", expiresInSeconds: 600, now }));
  for (const [candidate, status] of [[swapped, 403], [renamed, 403], [retyped, 403], [forged, 403]] as const) {
    assert.equal((await handle(new Request(candidate), env, { now, fetchImpl })).status, status, candidate.toString());
  }
  assert.equal((await handle(new Request(link), env, { now: now + 601_000, fetchImpl })).status, 403, "expired");
  const traversal = new URL(signFileCdnUrl(cdn, { objectKey: "submissions/../secret", filename: "a", contentType: "", expiresInSeconds: 600, now }));
  assert.equal((await handle(new Request(traversal), env, { now, fetchImpl })).status, 400);
  assert.equal((await handle(new Request("https://onside-files.example.workers.dev/f/%%%"), env, { now, fetchImpl })).status, 404);
  assert.equal((await handle(new Request(link, { method: "POST" }), env, { now, fetchImpl })).status, 405);
  assert.equal(calls.length, 0);
  // A Worker without its secrets refuses instead of reading storage unsigned.
  assert.equal((await handle(new Request(link), { ...env, B2_APPLICATION_KEY: "" }, { now, fetchImpl })).status, 503);
});

test("storage errors become clear messages, and HEAD returns headers only", async () => {
  const link = signFileCdnUrl(cdn, { objectKey: key, filename: "영상.mp4", contentType: "video/mp4", expiresInSeconds: 600, now });
  const capped = await handle(new Request(link), env, { now, fetchImpl: upstream([], () => new Response("<Error><Code>AccessDenied</Code><Message>Cannot download file, download bandwidth or transaction (Class B) cap exceeded.</Message></Error>", { status: 403 })) });
  assert.equal(capped.status, 503); assert.match(await capped.text(), /daily download limit/);
  assert.equal((await handle(new Request(link), env, { now, fetchImpl: upstream([], () => new Response("no", { status: 404 })) })).status, 404);
  assert.equal((await handle(new Request(link), env, { now, fetchImpl: upstream([], () => new Response("denied", { status: 403 })) })).status, 502);
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const head = await handle(new Request(link, { method: "HEAD" }), env, { now, fetchImpl: upstream(calls, () => new Response(null, { status: 200, headers: { "content-length": "565499565" } })) });
  assert.equal(head.status, 200); assert.equal(head.headers.get("content-length"), "565499565"); assert.equal(await head.text(), "");
  assert.equal(calls[0].init.method, "HEAD");
  assert.match(head.headers.get("content-disposition") ?? "", /filename\*=UTF-8''%EC%98%81%EC%83%81\.mp4/);
});

test("the service uses Cloudflare links only with an https base and a long enough secret", () => {
  const saved = { base: process.env.FILES_CDN_BASE_URL, secret: process.env.FILES_CDN_SIGNING_SECRET };
  try {
    process.env.FILES_CDN_BASE_URL = "https://onside-files.example.workers.dev/";
    process.env.FILES_CDN_SIGNING_SECRET = secret;
    assert.deepEqual(getFileCdnConfig(), cdn);
    process.env.FILES_CDN_SIGNING_SECRET = "short";
    assert.equal(getFileCdnConfig(), null);
    process.env.FILES_CDN_SIGNING_SECRET = secret;
    process.env.FILES_CDN_BASE_URL = "http://onside-files.example.workers.dev";
    assert.equal(getFileCdnConfig(), null);
    delete process.env.FILES_CDN_BASE_URL;
    assert.equal(getFileCdnConfig(), null);
  } finally {
    if (saved.base === undefined) delete process.env.FILES_CDN_BASE_URL; else process.env.FILES_CDN_BASE_URL = saved.base;
    if (saved.secret === undefined) delete process.env.FILES_CDN_SIGNING_SECRET; else process.env.FILES_CDN_SIGNING_SECRET = saved.secret;
  }
});
