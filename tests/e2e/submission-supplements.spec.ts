import { expect, test, type BrowserContext, type Page, type Route } from "@playwright/test";
import { archiveClientDocument } from "./support/music-archive-mount";

// Production UI with an entirely intercepted document, API, and object store.
// These cases prove client workflow/recovery, not real B2, DB, RLS, or auth.
const submissionId = "00000000-0000-4000-8000-000000000001";
const requestId = "00000000-0000-4000-8000-000000000002";
const guestToken = "fixture-guest-ownership-token";
const endpoint = `/api/submissions/${submissionId}/supplements`;
const partSize = 8;
const wav = Buffer.concat([Buffer.from("RIFF0000WAVE"), Buffer.from("fixture audio")]);
const lyrics = Buffer.from("보완 가사\n가사 전체");
const uploadFiles = [
  { name: "보완 음원 1.wav", mimeType: "audio/wav", buffer: wav },
  { name: "가사 수정.txt", mimeType: "text/plain", buffer: lyrics },
];
type FileRow = { id: string; original_name: string; size_bytes: number; status: string };
type Revision = { id: string; revision_no: number; status: string; note: string; review_note: string; files: FileRow[] };
type RequestRow = { id: string; note: string; status: string; created_at: string; revisions: Revision[] };
type Call = { action: string; fileId?: string; requestId?: string; decision?: string; note?: string; parts?: Array<{ partNumber: number; etag: string }>; partNumbers?: number[]; filename?: string; sizeBytes?: number };
let html: string;
test.beforeAll(async () => { html = await archiveClientDocument("./tests/e2e/support/submission-supplements-mount", "SubmissionSupplementsFixture"); });

async function fixture(context: BrowserContext, options: { delayUpload?: boolean; failUploadOnce?: boolean; lostCompletion?: boolean; lostInit?: boolean; initiallyDenied?: boolean } = {}) {
  const request: RequestRow = { id: requestId, note: "KBS 1번 트랙의 음원과 전체 가사를 보완해주세요.", status: "OPEN", created_at: "2026-10-24T01:00:00Z", revisions: [{ id: "revision-1", revision_no: 1, status: "DRAFT", note: "", review_note: "", files: [] }] };
  const calls: Call[] = [];
  const stored = new Map<string, Map<number, Buffer>>();
  const completed = new Set<string>();
  const uploadedParts: string[] = [];
  let nextFile = 0;
  let uploadFailed = false;
  let completionLost = false;
  let initLost = false;
  let denied = Boolean(options.initiallyDenied);
  let holdUpload = Boolean(options.delayUpload);
  const waitingUploads: Route[] = [];
  const file = (id?: string) => request.revisions.flatMap(revision => revision.files).find(row => row.id === id)!;
  const latest = () => request.revisions.at(-1)!;

  await context.route("**/*", async route => {
    const http = route.request();
    const url = new URL(http.url());
    if (http.resourceType() === "document" && url.pathname === "/__supplements-test") {
      await route.fulfill({ contentType: "text/html", body: html }); return;
    }
    if (url.hostname === "upload.supplement.invalid") {
      if (http.method() === "OPTIONS") {
        await route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "PUT, OPTIONS", "access-control-allow-headers": "*" } }); return;
      }
      const [id, part] = url.pathname.slice(1).split("/");
      uploadedParts.push(`${id}:${part}`);
      if (holdUpload) { waitingUploads.push(route); return; }
      if (options.failUploadOnce && !uploadFailed) { uploadFailed = true; await route.abort("connectionreset"); return; }
      stored.get(id)!.set(Number(part), http.postDataBuffer() ?? Buffer.alloc(0));
      await route.fulfill({ status: 200, headers: { etag: `"fixture-part-${part}-abcdefgh"`, "access-control-allow-origin": "*", "access-control-expose-headers": "etag" } }); return;
    }
    if (url.pathname === endpoint) {
      const admin = new URL(http.headers().referer || "https://fixture.invalid").searchParams.has("admin");
      if (!admin && http.headers()["x-guest-token"] !== guestToken) {
        await route.fulfill({ status: 403, json: { error: "Wrong guest ownership proof" } }); return;
      }
      if (denied) { await route.fulfill({ status: 403, json: { error: "fixture forbidden" } }); return; }
      if (http.method() === "GET") { await route.fulfill({ json: { requests: [request] } }); return; }
      const body = http.postDataJSON() as Call;
      calls.push(body);
      if (body.action === "init") {
        const row: FileRow = { id: `00000000-0000-4000-8000-${String(++nextFile + 100).padStart(12, "0")}`, original_name: body.filename!, size_bytes: body.sizeBytes!, status: "PENDING" };
        latest().files.push(row); stored.set(row.id, new Map());
        if (options.lostInit && !initLost) { initLost = true; await route.abort("connectionreset"); return; }
        await route.fulfill({ json: { ok: true, fileId: row.id, partSize, partCount: Math.ceil(row.size_bytes / partSize) } }); return;
      }
      if (body.action === "presign") {
        await route.fulfill({ json: { parts: body.partNumbers!.map(partNumber => ({ partNumber, url: `https://upload.supplement.invalid/${body.fileId}/${partNumber}` })) } }); return;
      }
      if (body.action === "complete") {
        const row = file(body.fileId);
        const data = stored.get(row.id)!;
        const expectedParts = Math.ceil(row.size_bytes / partSize);
        const valid = body.parts?.length === expectedParts && body.parts.every((part, index) => part.partNumber === index + 1 && part.etag === `fixture-part-${index + 1}-abcdefgh` && data.has(index + 1));
        if (!valid || Buffer.concat([...data.values()]).length !== row.size_bytes) { await route.fulfill({ status: 409, json: { error: "Invalid multipart fixture" } }); return; }
        completed.add(row.id);
        if (options.lostCompletion && !completionLost) { completionLost = true; await route.abort("connectionreset"); return; }
        row.status = "VERIFIED";
        await route.fulfill({ json: { ok: true, verified: true } }); return;
      }
      if (body.action === "recheck") {
        if (!completed.has(body.fileId!)) { await route.fulfill({ status: 409, json: { error: "Upload not completed" } }); return; }
        file(body.fileId).status = "VERIFIED";
        await route.fulfill({ json: { ok: true, verified: true } }); return;
      }
      if (body.action === "abort") {
        file(body.fileId).status = "ABORTED";
        await route.fulfill({ json: { ok: true, aborted: true } }); return;
      }
      if (body.action === "submit") {
        if (!latest().files.some(row => row.status === "VERIFIED") || latest().files.some(row => row.status === "PENDING")) { await route.fulfill({ status: 409, json: { error: "Files not ready" } }); return; }
        request.status = "SUBMITTED"; latest().status = "SUBMITTED"; latest().note = body.note ?? "";
        await route.fulfill({ json: { ok: true } }); return;
      }
      if (body.action === "review" && admin) {
        latest().status = body.decision!; latest().review_note = body.note ?? "";
        request.status = body.decision === "ACCEPTED" ? "ACCEPTED" : "OPEN";
        if (body.decision === "REJECTED") request.revisions.push({ id: `revision-${request.revisions.length + 1}`, revision_no: request.revisions.length + 1, status: "DRAFT", note: "", review_note: "", files: [] });
        await route.fulfill({ json: { ok: true } }); return;
      }
      if (body.action === "notify" && admin) {
        if (body.requestId !== requestId) { await route.fulfill({ status: 404, json: { error: "Wrong request" } }); return; }
        await route.fulfill({ json: { ok: true, notification: { email: "API_ACCEPTED", emailMessageId: "fixture-message-id", kakao: "SKIPPED" } } }); return;
      }
      await route.fulfill({ status: 400, json: { error: "Unsupported fixture mutation" } }); return;
    }
    // Includes all unexpected documents, API calls, auth, B2 and PG origins.
    await route.fulfill({ status: 404, body: "All real services are blocked by supplement UI fixture" });
  });
  return {
    calls, request, stored, uploadedParts,
    allowAccess: () => { denied = false; },
    releaseUpload: async () => { holdUpload = false; await Promise.all(waitingUploads.splice(0).map(route => route.abort("aborted").catch(() => undefined))); },
  };
}

async function open(page: Page, admin = false) {
  await page.goto(`/__supplements-test${admin ? "?admin=1" : ""}`);
  await page.getByRole("button", { name: "보완 내역 확인", exact: true }).click();
}

test("guest multi-file multipart, submission, rejection, second revision and admin acceptance preserve both histories", async ({ page, context }) => {
  const state = await fixture(context);
  await open(page);
  await expect(page.getByRole("button", { name: "보완 제출", exact: true })).toBeDisabled();
  await page.getByLabel("보완 파일 선택", { exact: true }).setInputFiles(uploadFiles);
  await expect(page.getByRole("status")).toContainText("파일 전송이 완료되었습니다");
  expect(state.calls.filter(call => call.action === "complete")).toHaveLength(2);
  for (const [index, row] of state.request.revisions[0].files.entries()) {
    expect(Buffer.concat([...state.stored.get(row.id)!.values()])).toEqual(uploadFiles[index].buffer);
  }
  await page.getByLabel("보완 내용", { exact: true }).fill("요청하신 음원과 가사입니다.");
  await page.getByRole("button", { name: "보완 제출", exact: true }).click();
  await expect(page.getByRole("heading", { name: "관리자 확인 대기", exact: true })).toBeVisible();
  await expect(page.getByLabel("보완 파일 선택", { exact: true })).toHaveCount(0);
  await open(page, true);
  await expect(page.getByRole("button", { name: "재보완 요청", exact: true })).toBeDisabled();
  await page.getByLabel("검수 내용·재보완 사유", { exact: true }).fill("가사 후렴 마지막 줄을 보완해주세요.");
  await page.getByRole("button", { name: "재보완 요청", exact: true }).click();
  await expect(page.getByText("버전 2 · 작성 중", { exact: true })).toBeVisible();
  await open(page);
  await expect(page.getByText("버전 1 · 재보완 요청", { exact: true })).toBeVisible();
  await expect(page.getByText("가사 후렴 마지막 줄을 보완해주세요.", { exact: true })).toBeVisible();
  await page.getByLabel("보완 파일 선택", { exact: true }).setInputFiles(uploadFiles[1]);
  await expect(page.getByRole("status")).toContainText("파일 전송이 완료되었습니다");
  await page.getByRole("button", { name: "보완 제출", exact: true }).click();
  await expect(page.getByRole("heading", { name: "관리자 확인 대기", exact: true })).toBeVisible();
  await open(page, true);
  await page.getByRole("button", { name: "보완 자료 수락", exact: true }).click();
  await expect(page.getByRole("heading", { name: "관리자 수락", exact: true })).toBeVisible();
  expect(state.request.revisions.map(revision => [revision.status, revision.files.length])).toEqual([["REJECTED", 2], ["ACCEPTED", 1]]);
  expect(state.calls.filter(call => call.action === "submit")).toHaveLength(2);
});

test("network failure cancels only the unfinished file and allows a clean retry", async ({ page, context }) => {
  const state = await fixture(context, { failUploadOnce: true });
  await open(page);
  await page.getByLabel("보완 파일 선택", { exact: true }).setInputFiles(uploadFiles[0]);
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("button", { name: "보완 제출", exact: true })).toBeDisabled();
  expect(state.calls.filter(call => call.action === "abort")).toHaveLength(1);
  expect(state.calls.filter(call => call.action === "complete")).toHaveLength(0);
  await page.getByLabel("보완 파일 선택", { exact: true }).setInputFiles(uploadFiles[0]);
  await expect(page.getByRole("status")).toContainText("파일 전송이 완료되었습니다");
  expect(state.request.revisions[0].files.map(row => row.status)).toEqual(["ABORTED", "VERIFIED"]);
  await expect(page.getByRole("button", { name: "보완 제출", exact: true })).toBeEnabled();
});

test("user cancellation interrupts an in-flight part and can be retried", async ({ page, context }) => {
  const state = await fixture(context, { delayUpload: true });
  await open(page);
  await page.getByLabel("보완 파일 선택", { exact: true }).setInputFiles(uploadFiles[0]);
  await expect.poll(() => state.uploadedParts.length).toBe(1);
  await page.getByRole("button", { name: "전송 취소", exact: true }).click();
  await state.releaseUpload();
  await expect(page.getByRole("alert")).toContainText("전송을 취소했습니다");
  expect(state.calls.filter(call => call.action === "abort")).toHaveLength(1);
  await page.getByLabel("보완 파일 선택", { exact: true }).setInputFiles(uploadFiles[0]);
  await expect(page.getByRole("status")).toContainText("파일 전송이 완료되었습니다");
});

test("uncertain completion is rechecked after reload without aborting or uploading another copy", async ({ page, context }) => {
  const state = await fixture(context, { lostCompletion: true });
  await open(page);
  await page.getByLabel("보완 파일 선택", { exact: true }).setInputFiles(uploadFiles[0]);
  await expect(page.getByRole("alert")).toBeVisible();
  expect(state.calls.filter(call => call.action === "abort")).toHaveLength(0);
  await open(page);
  await expect(page.getByRole("button", { name: "보완 제출", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "전송 확인 다시 시도", exact: true }).click();
  await expect(page.getByRole("button", { name: "보완 제출", exact: true })).toBeEnabled();
  expect(state.calls.filter(call => call.action === "init")).toHaveLength(1);
  expect(state.calls.filter(call => call.action === "complete")).toHaveLength(1);
  expect(state.calls.filter(call => call.action === "recheck")).toHaveLength(1);
});

test("a lost init response leaves a removable pending row that blocks submitting other verified files", async ({ page, context }) => {
  const state = await fixture(context, { lostInit: true });
  await open(page);
  await page.getByLabel("보완 파일 선택", { exact: true }).setInputFiles(uploadFiles[0]);
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByLabel("보완 파일 선택", { exact: true }).setInputFiles(uploadFiles[1]);
  await expect(page.getByRole("status")).toContainText("파일 전송이 완료되었습니다");
  await expect(page.getByRole("button", { name: "보완 제출", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "전송 취소", exact: true }).click();
  await expect(page.getByRole("button", { name: "보완 제출", exact: true })).toBeEnabled();
  expect(state.request.revisions[0].files.map(row => row.status)).toEqual(["ABORTED", "VERIFIED"]);
});

test("access failure stays recoverable and an empty file never initializes an upload", async ({ page, context }) => {
  const state = await fixture(context, { initiallyDenied: true });
  await open(page);
  await expect(page.getByRole("alert")).toContainText("조회 권한을 확인해주세요");
  state.allowAccess();
  await page.getByRole("button", { name: "새로 불러오기", exact: true }).click();
  await page.getByLabel("보완 파일 선택", { exact: true }).setInputFiles({ name: "빈 파일.txt", mimeType: "text/plain", buffer: Buffer.alloc(0) });
  await expect(page.getByRole("alert")).toContainText("빈 파일은 제출할 수 없습니다");
  expect(state.calls.filter(call => call.action === "init")).toHaveLength(0);
});

test("only staff can request a supplement notice and provider acceptance stays distinct from inbox delivery", async ({ page, context }) => {
  const state = await fixture(context);
  await open(page);
  await expect(page.getByRole("button", { name: "보완 안내 보내기·실패 재시도", exact: true })).toHaveCount(0);
  await open(page, true);
  await page.getByRole("button", { name: "보완 안내 보내기·실패 재시도", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("이메일: 발송 업체 접수");
  await expect(page.getByRole("status")).toContainText("카카오: 설정·수신처 확인 필요");
  await expect(page.getByRole("status")).toContainText("실제 수신 여부는 수신함에서 확인해주세요");
  expect(state.calls.filter(call => call.action === "notify")).toEqual([{ action: "notify", requestId }]);
  expect(state.request.status).toBe("OPEN");
  expect(state.calls.some(call => ["submit", "review", "complete"].includes(call.action))).toBe(false);
});
