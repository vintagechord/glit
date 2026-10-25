import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createReviewDeskHandlers } from "../src/lib/admin/review-desk-handler";
import { signDeskRequest } from "../src/lib/admin/review-desk-auth";

const secret = "fixture-only-hmac-secret";
const sid = "11111111-1111-4111-8111-111111111111";
const actor = "22222222-2222-4222-8222-222222222222";
const stationId = "33333333-3333-4333-8333-333333333333";
const requestId = "44444444-4444-4444-8444-444444444444";
const revision = "2026-10-25T00:00:00.000Z";
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
    async saveOnline(_db, input) { calls.push({ name: "online", input }); return state.saveError ? { ok: false, errorCode: state.saveError, error: "다른 화면에서 변경되었습니다." } : { ok: true, changed: state.changed }; },
    async saveCertificate(_db, input) { calls.push({ name: "certificate", input: { ...input, body: input.body.toString() } }); return { ok: true, changed: state.changed, certificate: { objectKey: "private/b2/path.pdf", originalName: input.filename, uploadedAt: revision } }; },
    notifyUpdate: input => notify("update-notice", input), notifyOnline: input => notify("online-notice", input),
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

test("station saves pass the authenticated actor and exact revision; conflicts/no-ops never notify", async () => {
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
  assert.equal(saved.notification.queuedCount, 1);
  const call = f.calls.find(c => c.name === "station")!.input as Record<string, unknown>;
  assert.equal(call.actorUserId, actor);
  assert.equal(call.expectedUpdatedAt, revision);
  assert.equal(call.reviewId, undefined);
  const notices = f.calls.filter(c => c.name === "update-notice");
  assert.equal(notices.length, 1);
  assert.match(String((notices[0].input as Record<string, unknown>).summary), /KBS: 12세 이상 시청가/);
});

test("online and deterministic certificate retries run the shared bundle notification even for no-op saves", async () => {
  const f = fixture(); f.state.changed = false;
  assert.equal((await f.handlers.POST(signedRequest("POST", { operation: "online", expectedUpdatedAt: revision, rating: "15" }), context)).status, 200);
  const path = `/api/internal/review-desk/${sid}?action=certificate&filename=${encodeURIComponent("필증.pdf")}&expectedUpdatedAt=${encodeURIComponent(revision)}&requestId=${requestId}`;
  const response = await f.handlers.POST(signedRequest("POST", undefined, { path, bytes: "%PDF-1.7 fixture", contentType: "application/pdf" }), context);
  const body = await response.json();
  assert.equal(body.changed, false);
  assert.equal(f.calls.filter(c => c.name === "online-notice").length, 2);
  assert.doesNotMatch(JSON.stringify(body), /private\/b2|objectKey/);
  const file = f.calls.find(c => c.name === "certificate")!.input as Record<string, unknown>;
  assert.equal(file.requestId, requestId);
  assert.equal(file.actorUserId, actor);
  assert.equal(file.filename, "필증.pdf");
});

test("explicit resend uses the signed stable UUID and refuses stale revisions or mismatched request IDs", async () => {
  const f = fixture();
  const body = { operation: "resend", expectedUpdatedAt: revision, requestId };
  await f.handlers.POST(signedRequest("POST", body), context);
  await f.handlers.POST(signedRequest("POST", body), context);
  const notices = f.calls.filter(c => c.name === "update-notice").map(c => c.input as Record<string, unknown>);
  assert.equal(notices.length, 2);
  assert.equal(notices[0].changeKey, `desk-resend-${requestId}`);
  assert.equal(notices[0].changeKey, notices[1].changeKey, "shared outbox deduplicates exact retry keys");
  assert.equal((await f.handlers.POST(signedRequest("POST", { ...body, expectedUpdatedAt: "2026-10-24T00:00:00.000Z" }), context)).status, 409);
  assert.equal((await f.handlers.POST(signedRequest("POST", { ...body, requestId: actor }), context)).status, 400);
  assert.equal(f.calls.filter(c => c.name.includes("notice")).length, 2);
});

test("size/content guards stop work and unexpected notification or refresh failures do not conceal committed saves", async () => {
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
  assert.match(body.notification.warning, /저장된 결과는 유지/);
  assert.match(body.snapshotWarning, /저장되었습니다/);
  assert.doesNotMatch(JSON.stringify(body), /private provider|private read/);
});
