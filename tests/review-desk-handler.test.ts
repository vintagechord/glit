import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createReviewDeskHandlers, createReviewDeskIntakeHandlers, createReviewDeskStorageHandlers } from "../src/lib/admin/review-desk-handler";
import { signDeskRequest } from "../src/lib/admin/review-desk-auth";

const secret = "fixture-only-hmac-secret";
const sid = "11111111-1111-4111-8111-111111111111";
const actor = "22222222-2222-4222-8222-222222222222";
const stationId = "33333333-3333-4333-8333-333333333333";
const requestId = "44444444-4444-4444-8444-444444444444";
const revision = "2026-10-25T00:00:00.000Z";
const previewRevision = "a".repeat(64);
const context = { params: Promise.resolve({ id: sid }) };
type Deps = Parameters<typeof createReviewDeskHandlers>[0];
type Snapshot = Awaited<ReturnType<Deps["loadSnapshot"]>>;
function fixture() {
  const calls: Array<{ name: string; input?: unknown }> = [];
  const state = { admin: true, profileError: false, schemaReady: true, changed: true, saveError: null as string | null, notifyThrows: false, snapshotThrows: false,
    snapshot: { type: "MV_BROADCAST", revision: "opaque", submission: { id: sid, type: "MV_BROADCAST", status: "IN_PROGRESS", updated_at: revision }, tracks: [],
      stations: [{ id: stationId, code: "KBS", name: "KBS", trackIds: [], review: { id: "review", status: "APPROVED", age_rating: "12", result_note: null, track_results: [], updated_at: revision } }],
      assets: { ready: false, rejected: false, missing: [], items: [], verification: "fixture" }, notifications: [], notificationWarning: null,
    } as unknown as Snapshot };
  const db = { from(table: string) {
    const query = { select() { return query; }, eq() { return query; }, limit() { return Promise.resolve({ data: [], error: state.schemaReady ? null : { code: "42703" } }); }, async maybeSingle() {
      assert.equal(table, "profiles");
      return { data: { role: state.admin ? "admin" : "user" }, error: state.profileError ? { message: "private fixture database error" } : null };
    } }; return query;
  }, async rpc(name: string) { assert.equal(name, "review_desk_protocol_status"); return { data: { protocol: 2 }, error: state.schemaReady ? null : { code: "PGRST202" } }; } } as unknown as SupabaseClient;
  const notify = async (name: string, input: unknown) => { calls.push({ name, input }); if (state.notifyThrows) throw Error("private provider error"); return { deliveredCount: 0, failedCount: 0, skippedCount: 0, recipientCount: 1, queuedCount: 1, warning: "자동 재시도 예정" }; };
  const handlers = createReviewDeskHandlers({ secret: () => secret, createDb() { calls.push({ name: "db" }); return db; },
    async loadSnapshot() { calls.push({ name: "snapshot" }); if (state.snapshotThrows) throw Error("private read error"); return state.snapshot; },
    async downloadAsset(_db, id, kind) { calls.push({ name: "download", input: { id, kind } }); return new Response("fixture-pdf", { headers: { "Content-Type": "application/pdf" } }); },
    async saveStation(_db, input) { calls.push({ name: "station", input }); return state.saveError ? { ok: false, errorCode: state.saveError, error: "다른 화면에서 변경되었습니다." } : { ok: true, changed: state.changed, changeKey: "revision-2", stationName: "KBS", submissionStatus: "RESULT_READY", row: { id: "review", submission_id: sid, station_id: stationId, status: "APPROVED", age_rating: "12", result_note: null, updated_at: revision } }; },
    async saveStations(_db, input) { calls.push({ name: "bulk-stations", input }); return state.saveError ? { ok: false, errorCode: state.saveError, error: "다른 화면에서 변경되었습니다." } : { ok: true, changed: true, savedCount: input.stations.length }; },
    async saveOnline(_db, input) { calls.push({ name: "online", input }); return state.saveError ? { ok: false, errorCode: state.saveError, error: "다른 화면에서 변경되었습니다." } : { ok: true, changed: state.changed }; },
    async saveCertificate(_db, input) { calls.push({ name: "certificate", input: { ...input, body: input.body.toString() } }); return { ok: true, changed: state.changed, certificate: { objectKey: "private/b2/path.pdf", originalName: input.filename, uploadedAt: revision } }; },
    async saveAlbumInfo(_db, input) { calls.push({ name: "album-info", input }); return state.saveError ? { ok: false, errorCode: "INVALID_TYPE", error: "음반 접수에만 신청서 정보를 반영할 수 있습니다." } : { ok: true, changed: state.changed, updatedFields: ["release_date"], updatedTracks: 1, insertedTracks: 0 }; },
    async previewEmail() { calls.push({ name: "preview" }); return { subject: "현재 결과", html: "<p>KBS: 12세 · MBC: 15세</p>", recipientMasked: "te***@example.test", revision: previewRevision, updatedAt: revision, canSend: true, missingAssets: [], warnings: [], attachmentCount: 0 }; },
    async sendSummary(input) { if (input.expectedRevision !== previewRevision || input.expectedUpdatedAt !== revision) return { deliveredCount: 0, skippedCount: 0, failedCount: 0, recipientCount: 0, errorCode: "CONFLICT", error: "미리보기가 변경되었습니다." }; return notify("summary-notice", input); },
    revalidate(id) { calls.push({ name: "revalidate", input: id }); },
  });
  return { handlers, state, calls };
}
function signedRequest(method: string, body?: unknown, options: { path?: string; contentType?: string; timestamp?: string; bytes?: string; contentLength?: string } = {}) {
  const path = options.path ?? `/api/internal/review-desk/${sid}`;
  const bytes = Buffer.from(options.bytes ?? (body === undefined ? "" : JSON.stringify(body)));
  const timestamp = options.timestamp ?? String(Date.now());
  const headers: Record<string, string> = {
    "x-onside-desk-time": timestamp, "x-onside-desk-request": requestId, "x-onside-desk-actor": actor,
    "x-onside-desk-signature": signDeskRequest(secret, { method, path, timestamp, requestId, actorId: actor, body: bytes }),
    "content-type": options.contentType ?? "application/json",
  };
  if (options.contentLength) headers["content-length"] = options.contentLength;
  return new Request(`https://fixture.invalid${path}`, { method, headers, ...(method === "GET" ? {} : { body: bytes.toString() }) });
}
const stationBody = { operation: "station", stationId, reviewId: null, expectedUpdatedAt: revision, status: "APPROVED", ageRating: "12", requestId };

test("HMAC bytes/path/time and live admin checks precede every snapshot, save and notification", async () => {
  const f = fixture();
  assert.equal((await f.handlers.GET(new Request(`https://fixture.invalid/${sid}`), context)).status, 401);
  assert.equal(f.calls.length, 0);
  const stale = signedRequest("POST", stationBody, { timestamp: String(Date.now() - 121_000) });
  assert.equal((await f.handlers.POST(stale, context)).status, 401);
  const original = signedRequest("POST", stationBody);
  const tampered = new Request(original.url, { method: "POST", headers: original.headers, body: JSON.stringify({ ...stationBody, ageRating: "19" }) });
  assert.equal((await f.handlers.POST(tampered, context)).status, 401);
  const moved = new Request(original.url + "?action=certificate", { method: "POST", headers: original.headers, body: JSON.stringify(stationBody) });
  assert.equal((await f.handlers.POST(moved, context)).status, 401);
  assert.equal(f.calls.length, 0);
  f.state.admin = false;
  assert.equal((await f.handlers.GET(signedRequest("GET"), context)).status, 403);
  assert.deepEqual(f.calls.map(c => c.name), ["db"]);
  f.state.admin = true; f.state.profileError = true;
  assert.equal((await f.handlers.POST(signedRequest("POST", stationBody), context)).status, 503);
  assert.ok(!f.calls.some(c => /notice|station|snapshot/.test(c.name)));
});

test("health checks protocol/schema and GET returns the raw snapshot or bounded asset proxy", async () => {
  const f = fixture();
  const healthContext = { params: Promise.resolve({ id: "health" }) };
  const health = await f.handlers.GET(signedRequest("GET", undefined, { path: "/api/internal/review-desk/health" }), healthContext);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).protocol, 2);
  f.state.schemaReady = false;
  assert.equal((await f.handlers.GET(signedRequest("GET", undefined, { path: "/api/internal/review-desk/health" }), healthContext)).status, 503);
  assert.deepEqual(await (await f.handlers.GET(signedRequest("GET"), context)).json(), f.state.snapshot);
  const file = await f.handlers.GET(signedRequest("GET", undefined, { path: `/api/internal/review-desk/${sid}?asset=certificate` }), context);
  assert.equal(await file.text(), "fixture-pdf");
  assert.equal((await f.handlers.GET(signedRequest("GET", undefined, { path: `/api/internal/review-desk/${sid}?asset=arbitrary` }), context)).status, 400);
});

test("station saves pass the authenticated actor and exact revision; no result save notifies", async () => {
  const f = fixture();
  f.state.saveError = "CONFLICT";
  assert.equal((await f.handlers.POST(signedRequest("POST", stationBody), context)).status, 409);
  assert.ok(!f.calls.some(c => c.name.includes("notice")));
  f.state.saveError = null; f.state.changed = false;
  const unchanged = await (await f.handlers.POST(signedRequest("POST", stationBody), context)).json();
  assert.equal(unchanged.changed, false);
  assert.equal(unchanged.notification, null);
  f.state.changed = true;
  const saved = await (await f.handlers.POST(signedRequest("POST", stationBody), context)).json();
  assert.equal(saved.ok, true);
  assert.equal(saved.notification, null);
  const call = f.calls.find(c => c.name === "station")!.input as Record<string, unknown>;
  assert.equal(call.actorUserId, actor);
  assert.equal(call.expectedUpdatedAt, revision);
  assert.equal(call.reviewId, undefined);
  assert.equal(f.calls.filter(c => c.name.includes("notice")).length, 0);
});

test("online and deterministic certificate retries never send result mail, including no-op saves", async () => {
  const f = fixture(); f.state.changed = false;
  assert.equal((await f.handlers.POST(signedRequest("POST", { operation: "online", expectedUpdatedAt: revision, rating: "15" }), context)).status, 200);
  const path = `/api/internal/review-desk/${sid}?action=certificate&filename=${encodeURIComponent("필증.pdf")}&expectedUpdatedAt=${encodeURIComponent(revision)}&requestId=${requestId}`;
  const response = await f.handlers.POST(signedRequest("POST", undefined, { path, bytes: "%PDF-1.7 fixture", contentType: "application/pdf" }), context);
  const body = await response.json();
  assert.equal(body.changed, false);
  assert.equal(f.calls.filter(c => c.name.includes("notice")).length, 0);
  assert.doesNotMatch(JSON.stringify(body), /private\/b2|objectKey/);
  const file = f.calls.find(c => c.name === "certificate")!.input as Record<string, unknown>;
  assert.equal(file.requestId, requestId);
  assert.equal(file.actorUserId, actor);
  assert.equal(file.filename, "필증.pdf");
});

test("explicit resend uses the signed stable UUID and refuses stale revisions or mismatched request IDs", async () => {
  const f = fixture();
  const body = { operation: "send", expectedUpdatedAt: revision, expectedRevision: previewRevision, requestId };
  await f.handlers.POST(signedRequest("POST", body), context);
  await f.handlers.POST(signedRequest("POST", body), context);
  const notices = f.calls.filter(c => c.name === "summary-notice").map(c => c.input as Record<string, unknown>);
  assert.equal(notices.length, 2);
  assert.equal(notices[0].requestId, requestId);
  assert.equal(notices[0].requestId, notices[1].requestId, "shared outbox deduplicates exact retry keys");
  assert.equal((await f.handlers.POST(signedRequest("POST", { ...body, expectedUpdatedAt: "2026-10-24T00:00:00.000Z" }), context)).status, 409);
  assert.equal((await f.handlers.POST(signedRequest("POST", { ...body, requestId: actor }), context)).status, 400);
  assert.equal(f.calls.filter(c => c.name.includes("notice")).length, 2);
});

test("size/content guards stop work and refresh failure does not conceal a save or call mail", async () => {
  const f = fixture();
  assert.equal((await f.handlers.POST(signedRequest("POST", stationBody, { contentLength: String(3 * 1024 * 1024 + 1) }), context)).status, 413);
  assert.equal(f.calls.length, 0);
  assert.equal((await f.handlers.POST(signedRequest("POST", undefined, { bytes: "{broken" }), context)).status, 400);
  assert.equal((await f.handlers.POST(signedRequest("POST", stationBody, { contentType: "text/plain" }), context)).status, 415);
  assert.ok(!f.calls.some(c => c.name === "station"));
  f.state.notifyThrows = true; f.state.snapshotThrows = true;
  const saved = await f.handlers.POST(signedRequest("POST", stationBody), context);
  assert.equal(saved.status, 200);
  const body = await saved.json();
  assert.equal(body.changed, true);
  assert.equal(body.notification, null);
  assert.equal(f.calls.filter(c => c.name.includes("notice")).length, 0);
  assert.match(body.snapshotWarning, /저장되었습니다/);
  assert.doesNotMatch(JSON.stringify(body), /private provider|private read/);
});


test("multiple broadcaster saves and email preview cause zero mail until one explicit send", async () => {
  const f = fixture();
  await f.handlers.POST(signedRequest("POST", stationBody), context);
  await f.handlers.POST(signedRequest("POST", { ...stationBody, stationId: "77777777-7777-4777-8777-777777777777", ageRating: "15" }), context);
  const preview = await f.handlers.GET(signedRequest("GET", undefined, { path: `/api/internal/review-desk/${sid}?preview=email` }), context);
  const data = await preview.json();
  assert.match(data.html, /KBS.*MBC/);
  assert.equal(f.calls.filter(c => c.name.includes("notice")).length, 0);
  const response = await f.handlers.POST(signedRequest("POST", { operation: "send", expectedRevision: data.revision, expectedUpdatedAt: data.updatedAt, requestId }), context);
  assert.equal(response.status, 200);
  assert.equal(f.calls.filter(c => c.name === "summary-notice").length, 1);
  assert.equal((await f.handlers.POST(signedRequest("POST", { operation: "send", requestId }), context)).status, 400);
});


test("signed bulk saves return one refreshed snapshot and never send mail", async () => {
  const f=fixture();
  const input={operation:"bulk-stations",stations:[{stationId,reviewId:null,expectedUpdatedAt:revision}],status:"SENT",requestId};
  const response=await f.handlers.POST(signedRequest("POST",input),context);
  assert.equal(response.status,200);const body=await response.json();assert.equal(body.savedCount,1);assert.equal(body.notification,null);
  assert.equal(f.calls.filter(c=>c.name==="bulk-stations").length,1);assert.ok(!f.calls.some(c=>c.name.includes("notice")));
  const saved=f.calls.find(c=>c.name==="bulk-stations")!.input as Record<string,unknown>;assert.equal(saved.actorUserId,actor);assert.equal(saved.submissionId,sid);
  f.state.saveError="CONFLICT";
  assert.equal((await f.handlers.POST(signedRequest("POST",input),context)).status,409);
});

function storageFixture() {
  const calls: Array<{ name: string; input?: unknown }> = [];
  const state = { admin: true, b2Missing: false };
  const db = { from(table: string) {
    const query = { select() { return query; }, eq() { return query; }, async maybeSingle() { assert.equal(table, "profiles"); return { data: { role: state.admin ? "admin" : "user" }, error: null }; } };
    return query;
  } } as unknown as SupabaseClient;
  const handlers = createReviewDeskStorageHandlers({ secret: () => secret, createDb() { calls.push({ name: "db" }); return db; },
    async loadCandidates(_db, _ids, scope) {
      calls.push({ name: "candidates", input: scope });
      if (state.b2Missing) throw Object.assign(new Error("B2 env missing"), { name: "B2ConfigError" });
      return [{ submissionId: sid, title: "검증 영상", artistName: "검증 가수", type: "MV_DISTRIBUTION", refunded: false, paymentPending: false, stage: "finished" as const, finishedAt: revision,
        files: [{ source: "upload" as const, id: "file", objectKey: "submissions/private-user/video.mp4", sizeBytes: 438_000_000 }], totalBytes: 438_000_000 }];
    },
    async purge(_db, ids, actorId, _remove, scope) {
      calls.push({ name: "purge", input: scope === "received" ? { ids, actorId, scope } : { ids, actorId } });
      return ids.map((submissionId) => ({ submissionId, ok: true, deletedFiles: 1, failedFiles: 0, freedBytes: 438_000_000 }));
    },
    async loadInventory(_db, options) {
      calls.push({ name: "inventory", input: options?.candidates?.map((candidate) => candidate.submissionId) });
      return {
        checkedAt: revision, truncated: false, totalBytes: 999_000_000, totalVersions: 3, hiddenMarkers: 1, keys: 2,
        groups: [{ key: "purgeable" as const, count: 1, bytes: 438_000_000 }, { key: "leftover" as const, count: 2, bytes: 561_000_000 }],
        held: [],
        leftovers: [{ id: leftoverId, reason: "hidden_upload" as const, name: "old-mv.mp4", submissionId: sid, submissionTitle: "검증 영상", bytes: 561_000_000, versionCount: 2, lastModified: revision,
          key: "submissions/private-user/title/old-mv.mp4", versions: [{ versionId: "secret-version", size: 561_000_000 }] }],
      };
    },
    async deleteLeftovers(_db, ids) {
      calls.push({ name: "leftovers", input: ids });
      return ids.map((id) => ({ id, ok: true, deletedVersions: 2, failedVersions: 0, freedBytes: 561_000_000 }));
    },
  });
  return { handlers, state, calls };
}
const storagePath = "/api/internal/review-desk/storage";
const leftoverId = "0123456789abcdef0123456789abcdef";

test("desk storage list is signed, admin-only and never returns object keys", async () => {
  const f = storageFixture();
  assert.equal((await f.handlers.GET(new Request(`https://fixture.invalid${storagePath}`))).status, 401);
  f.state.admin = false;
  assert.equal((await f.handlers.GET(signedRequest("GET", undefined, { path: storagePath }))).status, 403);
  assert.ok(!f.calls.some(call => call.name === "candidates"));
  f.state.admin = true;
  const response = await f.handlers.GET(signedRequest("GET", undefined, { path: storagePath }));
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.doesNotMatch(text, /objectKey|submissions\/private-user/);
  assert.deepEqual(JSON.parse(text), { ok: true, batchLimit: 10, scope: "finished", items: [{ submissionId: sid, title: "검증 영상", artistName: "검증 가수", type: "MV_DISTRIBUTION", refunded: false, paymentPending: false, stage: "finished", finishedAt: revision, fileCount: 1, totalBytes: 438_000_000,
    files: [{ id: "file", source: "upload", sizeBytes: 438_000_000 }] }] });
  // The desk asks for submissions still in review too; the scope is part of the signed path.
  const received = await f.handlers.GET(signedRequest("GET", undefined, { path: `${storagePath}?scope=received` }));
  assert.equal(received.status, 200); assert.equal((await received.json()).scope, "received");
  assert.equal(f.calls.filter(call => call.name === "candidates").at(-1)?.input, "received");
  assert.equal((await f.handlers.GET(signedRequest("GET", undefined, { path: `${storagePath}?scope=everything` }))).status, 400);
  f.state.b2Missing = true;
  const missing = await f.handlers.GET(signedRequest("GET", undefined, { path: storagePath }));
  assert.equal(missing.status, 500); assert.equal((await missing.json()).error, "파일 저장소 설정을 확인할 수 없습니다.");
});

test("desk storage purge records the desk administrator and accepts at most one batch", async () => {
  const f = storageFixture();
  const body = { operation: "purge", submissionIds: [sid], requestId };
  const tampered = signedRequest("POST", body, { path: storagePath });
  assert.equal((await f.handlers.POST(new Request(tampered.url, { method: "POST", headers: tampered.headers, body: JSON.stringify({ ...body, submissionIds: [stationId] }) }))).status, 401);
  assert.equal((await f.handlers.POST(signedRequest("POST", body, { path: storagePath, contentType: "text/plain" }))).status, 415);
  const tooMany = { ...body, submissionIds: Array.from({ length: 11 }, (_, index) => `11111111-1111-4111-8111-${String(index).padStart(12, "0")}`) };
  assert.equal((await f.handlers.POST(signedRequest("POST", tooMany, { path: storagePath }))).status, 400);
  assert.equal((await f.handlers.POST(signedRequest("POST", { ...body, requestId: stationId }, { path: storagePath }))).status, 400);
  assert.ok(!f.calls.some(call => call.name === "purge"));
  const response = await f.handlers.POST(signedRequest("POST", body, { path: storagePath }));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).results, [{ submissionId: sid, ok: true, deletedFiles: 1, failedFiles: 0, freedBytes: 438_000_000 }]);
  assert.deepEqual(f.calls.find(call => call.name === "purge")?.input, { ids: [sid], actorId: actor });
});

test("the desk inventory accounts for every stored byte and lists leftovers without keys or version ids", async () => {
  const f = storageFixture();
  const plain = await (await f.handlers.GET(signedRequest("GET", undefined, { path: `${storagePath}?scope=received` }))).json();
  assert.equal(plain.inventory, undefined, "the inventory is only listed when asked for");
  assert.ok(!f.calls.some(call => call.name === "inventory"));
  const response = await f.handlers.GET(signedRequest("GET", undefined, { path: `${storagePath}?scope=received&inventory=1` }));
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.doesNotMatch(text, /private-user|secret-version|"key":"submissions|"versions"/);
  const body = JSON.parse(text);
  // The purge list is passed in so its files are counted as purgeable, not as held.
  assert.deepEqual(f.calls.find(call => call.name === "inventory")?.input, [sid]);
  assert.equal(body.leftoverBatchLimit, 25);
  assert.deepEqual(body.inventory.leftovers, [{ id: leftoverId, reason: "hidden_upload", name: "old-mv.mp4", submissionId: sid, submissionTitle: "검증 영상", bytes: 561_000_000, versionCount: 2, lastModified: revision }]);
  assert.equal(body.inventory.totalBytes, 999_000_000);
});

test("leftover deletion is signed, takes listed ids only and at most one batch", async () => {
  const f = storageFixture();
  const body = { operation: "leftovers", ids: [leftoverId], requestId };
  assert.equal((await f.handlers.POST(signedRequest("POST", { ...body, ids: ["submissions/private-user/title/old-mv.mp4"] }, { path: storagePath }))).status, 400);
  assert.equal((await f.handlers.POST(signedRequest("POST", { ...body, ids: Array.from({ length: 26 }, (_, index) => index.toString(16).padStart(32, "0")) }, { path: storagePath }))).status, 400);
  assert.equal((await f.handlers.POST(signedRequest("POST", { ...body, requestId: stationId }, { path: storagePath }))).status, 400);
  f.state.admin = false;
  assert.equal((await f.handlers.POST(signedRequest("POST", body, { path: storagePath }))).status, 403);
  f.state.admin = true;
  assert.ok(!f.calls.some(call => call.name === "leftovers"));
  const response = await f.handlers.POST(signedRequest("POST", body, { path: storagePath }));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).results, [{ id: leftoverId, ok: true, deletedVersions: 2, failedVersions: 0, freedBytes: 561_000_000 }]);
  assert.deepEqual(f.calls.find(call => call.name === "leftovers")?.input, [leftoverId]);
  assert.ok(!f.calls.some(call => call.name === "purge"), "a leftover request never reaches the customer-file purge");
});

const packageId = "55555555-5555-4555-8555-555555555555";
const intakePath = "/api/internal/review-desk/intake";
function intakeFixture() {
  const calls: Array<{ name: string; input?: unknown }> = [];
  const state = { admin: true, rpcError: null as string | null, packageActive: true };
  const db = {
    from(table: string) {
      const query = {
        select() { return query; }, eq() { return query; },
        async maybeSingle() {
          if (table === "profiles") return { data: { role: state.admin ? "admin" : "user" }, error: null };
          assert.equal(table, "packages");
          return { data: state.packageActive ? { price_krw: 130000 } : null, error: null };
        },
      };
      return query;
    },
    async rpc(name: string, args: Record<string, unknown>) {
      assert.equal(name, "admin_register_guest_album");
      calls.push({ name: "rpc", input: args });
      return state.rpcError ? { data: null, error: { message: state.rpcError } } : { data: [{ submission_id: sid, created: true }], error: null };
    },
  } as unknown as SupabaseClient;
  const handlers = createReviewDeskIntakeHandlers({ secret: () => secret, createDb: () => db,
    async listPackages() { calls.push({ name: "packages" }); return [{ id: packageId, name: "13곳 패키지", stationCount: 13, priceKrw: 130000, stations: ["KBS"] }]; },
    async ensureArtist(name) { calls.push({ name: "artist", input: name }); return "66666666-6666-4666-8666-666666666666"; },
    trackUrl: (token) => `https://onside.example/track/${token}`,
    revalidate(id) { calls.push({ name: "revalidate", input: id }); },
  });
  return { handlers, state, calls };
}
const intakeBody = {
  operation: "register-guest-album", requestId, packageId, paid: true,
  guest: { name: "홍길동", phone: "010-0000-0000", email: "guest@example.invalid" },
  submission: { title: "대리 접수 앨범", artistName: "대리 가수", releaseDate: "2026-11-05", artistType: "GROUP" },
  tracks: [{ trackTitle: "첫 곡", lyrics: "가사", isTitle: true, broadcastSelected: true }, { trackTitle: "둘째 곡", isTitle: true }],
};

test("desk intake registers a guest album with the signed request ID as its lookup code", async () => {
  const f = intakeFixture();
  assert.equal((await f.handlers.POST(new Request(`https://fixture.invalid${intakePath}`, { method: "POST", body: JSON.stringify(intakeBody) }))).status, 401);
  f.state.admin = false;
  assert.equal((await f.handlers.POST(signedRequest("POST", intakeBody, { path: intakePath }))).status, 403);
  f.state.admin = true;
  assert.equal((await f.handlers.POST(signedRequest("POST", { ...intakeBody, guest: { name: "" } }, { path: intakePath }))).status, 400);
  assert.equal((await f.handlers.POST(signedRequest("POST", { ...intakeBody, guest: { name: "홍길동", email: "not-an-email" } }, { path: intakePath }))).status, 400);
  assert.equal((await f.handlers.POST(signedRequest("POST", { ...intakeBody, submission: { ...intakeBody.submission, releaseDate: "2026.11.05" } }, { path: intakePath }))).status, 400);
  assert.equal((await f.handlers.POST(signedRequest("POST", { ...intakeBody, requestId: stationId }, { path: intakePath }))).status, 400);
  assert.ok(!f.calls.some(call => call.name === "rpc"));
  const response = await f.handlers.POST(signedRequest("POST", intakeBody, { path: intakePath }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, created: true, submissionId: sid, guestToken: requestId, trackUrl: `https://onside.example/track/${requestId}`, paid: true });
  const args = f.calls.find(call => call.name === "rpc")?.input as Record<string, unknown> & { p_parent: Record<string, unknown>; p_tracks: Array<Record<string, unknown>> };
  assert.equal(args.p_actor_user_id, actor); assert.equal(args.p_guest_token, requestId); assert.equal(args.p_amount_krw, 130000); assert.equal(args.p_paid, true);
  assert.equal(args.p_parent.guest_name, "홍길동"); assert.equal(args.p_parent.applicant_name, "홍길동"); assert.equal(args.p_parent.artist_type, "GROUP");
  assert.equal(args.p_parent.artist_id, "66666666-6666-4666-8666-666666666666");
  assert.deepEqual(args.p_tracks.map(track => [track.track_title, track.is_title, track.title_role, track.broadcast_selected]), [["첫 곡", true, "MAIN", true], ["둘째 곡", true, "SUB", false]]);
  assert.deepEqual(f.calls.filter(call => call.name === "revalidate").map(call => call.input), [sid]);
});

test("desk intake explains package and validation refusals and lists packages", async () => {
  const f = intakeFixture();
  f.state.rpcError = "PACKAGE_STATIONS_INVALID";
  const refused = await f.handlers.POST(signedRequest("POST", intakeBody, { path: intakePath }));
  assert.equal(refused.status, 400); assert.match((await refused.json()).error, /패키지의 방송사 구성/);
  f.state.packageActive = false;
  assert.equal((await f.handlers.POST(signedRequest("POST", intakeBody, { path: intakePath }))).status, 400);
  const list = await f.handlers.GET(signedRequest("GET", undefined, { path: intakePath }));
  assert.equal(list.status, 200); assert.equal((await list.json()).packages[0].name, "13곳 패키지");
});

test("album-info applies the desk's application details through the shared save and reports the counts", async () => {
  const f = fixture();
  const body = { operation: "album-info", requestId, submission: { releaseDate: "2026-11-05", genre: "성인가요", distributor: "유통사", productionCompany: "제작사", artistType: "SOLO" },
    tracks: [{ trackNo: 1, trackTitle: "지금이 딱 좋아", composer: "김수련", lyricist: "김수련", lyrics: "가사", isTitle: true, broadcastSelected: true }] };
  const response = await f.handlers.POST(signedRequest("POST", body), context);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true); assert.deepEqual(payload.albumInfo, { updatedFields: ["release_date"], updatedTracks: 1, insertedTracks: 0 });
  const call = f.calls.find(c => c.name === "album-info")?.input as { submissionId: string; actorUserId: string; mode: string; source: string; input: { submission: Record<string, unknown>; tracks: Array<Record<string, unknown>> } };
  assert.equal(call.submissionId, sid); assert.equal(call.actorUserId, actor); assert.equal(call.mode, "overwrite"); assert.equal(call.source, "심의 데스크");
  assert.equal(call.input.submission.releaseDate, "2026-11-05"); assert.equal(call.input.submission.title, null);
  assert.equal(call.input.tracks[0].trackTitle, "지금이 딱 좋아"); assert.equal(call.input.tracks[0].isTitle, true);
  assert.ok(f.calls.some(c => c.name === "revalidate" && c.input === sid));
  // Validation happens before any save: a bad date or an empty track title is refused.
  assert.equal((await f.handlers.POST(signedRequest("POST", { ...body, submission: { releaseDate: "2026.11.05" } }), context)).status, 400);
  assert.equal((await f.handlers.POST(signedRequest("POST", { ...body, tracks: [{ trackNo: 1, trackTitle: " " }] }), context)).status, 400);
  assert.equal(f.calls.filter(c => c.name === "album-info").length, 1);
  f.state.saveError = "INVALID_TYPE";
  const refused = await f.handlers.POST(signedRequest("POST", body), context);
  assert.equal(refused.status, 400); assert.equal((await refused.json()).errorCode, "INVALID_TYPE");
});

test("purging files of submissions still in review requires the desk's local-copy declaration", async () => {
  const f = storageFixture();
  const body = { operation: "purge", submissionIds: [sid], requestId, scope: "received" };
  assert.equal((await f.handlers.POST(signedRequest("POST", body, { path: storagePath }))).status, 400);
  assert.equal((await f.handlers.POST(signedRequest("POST", { ...body, localCopiesVerified: false }, { path: storagePath }))).status, 400);
  assert.ok(!f.calls.some(call => call.name === "purge"));
  const response = await f.handlers.POST(signedRequest("POST", { ...body, localCopiesVerified: true }, { path: storagePath }));
  assert.equal(response.status, 200);
  assert.deepEqual(f.calls.find(call => call.name === "purge")?.input, { ids: [sid], actorId: actor, scope: "received" });
});
