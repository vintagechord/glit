import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DESK_PROTOCOL_VERSION, readBoundedDeskBody, verifyDeskRequest } from "./review-desk-auth";
import { stationManagementSchema, stationBulkSchema, type ManagedReviewResult } from "./review-management";
import type { loadDeskResults, downloadDeskResultAsset } from "./review-desk";
import type { saveManagedStationReview, saveManagedStationReviews, saveManagedOnlineReview } from "./review-management";
import type { saveManagedCertificate } from "./certificate-save";
import { SERVER_UPLOAD_MAX_BYTES } from "@/lib/server-upload-limit";
import type { getReviewSummaryEmailPreviewById, sendReviewSummaryNotificationById, SubmissionNotificationOutcome } from "./submission-notifications";
import type { loadPurgeCandidates, purgeCustomerFiles } from "./customer-file-purge";
import { PURGE_BATCH_LIMIT } from "./customer-file-purge-limits";
import { buildGuestAlbumIntakeRecord, guestAlbumIntakeFailure, guestAlbumIntakeSchema, type listGuestAlbumIntakePackages } from "./guest-album-intake";
import { getAlbumReviewPriceKrw } from "@/lib/album-pricing";

const uuid = z.string().uuid();
const revision = z.string().datetime({ offset: true });
const stationBody = stationManagementSchema.omit({ actorUserId: true, submissionId: true }).extend({
  operation: z.literal("station"), reviewId: uuid.nullish(), requestId: uuid.optional(),
});
const onlineBody = z.object({ operation: z.literal("online"), expectedUpdatedAt: revision, rating: z.enum(["ALL", "12", "15", "18", "19", "REJECT"]), resultMemo: z.string().max(4000).optional(), requestId: uuid.optional() });
const bulkBody = stationBulkSchema.omit({ actorUserId: true, submissionId: true }).extend({ operation: z.literal("bulk-stations"), requestId: uuid.optional() });
const sendBody = z.object({ operation: z.enum(["send", "resend"]), expectedUpdatedAt: revision, expectedRevision: z.string().regex(/^[a-f0-9]{64}$/), requestId: uuid });
const bodySchema = z.discriminatedUnion("operation", [stationBody, bulkBody, onlineBody, sendBody]);
const assetSchema = z.enum(["ratingImage", "usageGuide", "certificate"]);
const jsonResponse = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
const failure = (status: number, error: string, errorCode?: string) => jsonResponse({ ok: false, error, ...(errorCode ? { errorCode } : {}) }, status);
const saveFailure = (result: ManagedReviewResult) => failure(
  result.errorCode === "CONFLICT" ? 409 : result.errorCode === "FORBIDDEN" ? 403 :
    ["INVALID", "INVALID_TYPE", "INVALID_TRACK", "NOT_REQUESTED", "RATING_REQUIRED", "PER_STATION_REQUIRED"].includes(result.errorCode ?? "") ? 400 :
      result.errorCode === "UPGRADE_REQUIRED" ? 503 : 500,
  result.error ?? "심의 결과를 저장하지 못했습니다.", result.errorCode,
);

type Dependencies = {
  secret: () => string;
  createDb: () => SupabaseClient;
  loadSnapshot: typeof loadDeskResults;
  downloadAsset: typeof downloadDeskResultAsset;
  saveStation: typeof saveManagedStationReview;
  saveStations: typeof saveManagedStationReviews;
  saveOnline: typeof saveManagedOnlineReview;
  saveCertificate: typeof saveManagedCertificate;
  previewEmail: typeof getReviewSummaryEmailPreviewById;
  sendSummary: typeof sendReviewSummaryNotificationById;
  revalidate: (submissionId: string) => void;
};
type Context = { params: Promise<{ id: string }> };

/** Signed bytes first, then a live administrator role, before any DB work. */
async function authenticateDeskAdmin(deps: Pick<Dependencies, "secret" | "createDb">, request: Request, body: Buffer) {
  const identity = verifyDeskRequest(request, body, deps.secret());
  if (!identity) return { error: failure(401, "Mac 연동 인증을 확인하지 못했습니다.") } as const;
  const db = deps.createDb();
  const { data: actor, error } = await db.from("profiles").select("role").eq("user_id", identity.actorId).maybeSingle();
  if (error) return { error: failure(503, "관리자 권한을 확인하지 못했습니다. 잠시 후 다시 시도해주세요.") } as const;
  if (actor?.role !== "admin") return { error: failure(403, "관리자 권한이 필요합니다.") } as const;
  return { db, ...identity } as const;
}

/** The route and its synthetic tests share these handlers. No DB or mail
 * operation is reachable until the signed bytes and live administrator role pass. */
export function createReviewDeskHandlers(deps: Dependencies) {
  const authenticate = (request: Request, body: Buffer) => authenticateDeskAdmin(deps, request, body);
  async function finish(db: SupabaseClient, id: string, changed: boolean, notification: SubmissionNotificationOutcome | null, extras: Record<string, unknown> = {}) {
    try { deps.revalidate(id); } catch { /* A committed save remains successful. */ }
    const snapshot = await deps.loadSnapshot(db, id).catch(() => null);
    return jsonResponse({ ok: true, changed, notification, warning: notification?.warning,
      ...(snapshot ? { snapshot } : { snapshotWarning: "변경사항은 저장되었습니다. 최신 결과를 다시 불러와주세요." }), ...extras });
  }
  function requestFailure(error: unknown) {
    if (error instanceof Error && error.name === "ReviewEmailPreviewError" && "status" in error && typeof error.status === "number") return failure(error.status, error.message);
    if (error && typeof error === "object" && "status" in error && error.status === 413) return failure(413, "파일 또는 입력 데이터가 허용 크기를 초과했습니다.");
    return failure(500, "서비스 연결 또는 처리 상태를 확인하지 못했습니다. 최신 내용을 다시 불러온 뒤 확인해주세요.");
  }
  async function GET(request: Request, context: Context) {
    try {
      const auth = await authenticate(request, await readBoundedDeskBody(request, 0));
      if (auth.error) return auth.error;
      const { id } = await context.params;
      if (id === "health") {
        const [protocol, station, outbox] = await Promise.all([
          auth.db.rpc("review_desk_protocol_status"),
          auth.db.from("station_reviews").select("age_rating").limit(0),
          auth.db.from("email_outbox").select("attachment_refs").limit(0),
        ]);
        const schemaReady = !protocol.error && protocol.data?.protocol === DESK_PROTOCOL_VERSION && !station.error && !outbox.error;
        return jsonResponse({ ok: schemaReady, protocol: DESK_PROTOCOL_VERSION, schemaReady,
          capabilities: { stationResults: schemaReady, bulkStationResults: schemaReady && protocol.data?.bulkStationResults === true, onlineBundle: schemaReady, certificate: schemaReady, separateEmailSend: true, emailPreview: true, storagePurge: true, guestAlbumIntake: true },
          ...(schemaReady ? {} : { error: "심의 연동 서비스 업데이트가 아직 완료되지 않았습니다." }),
        }, schemaReady ? 200 : 503);
      }
      if (!uuid.safeParse(id).success) return failure(400, "접수 ID를 확인해주세요.");
      const preview = new URL(request.url).searchParams.get("preview");
      if (preview !== null) {
        if (preview !== "email") return failure(400, "미리보기 항목을 확인해주세요.");
        return jsonResponse(await deps.previewEmail({ submissionId: id }));
      }
      const asset = new URL(request.url).searchParams.get("asset");
      if (asset !== null) {
        const parsed = assetSchema.safeParse(asset);
        if (!parsed.success) return failure(400, "다운로드 항목을 확인해주세요.");
        try { return await deps.downloadAsset(auth.db, id, parsed.data); }
        catch (error) {
          if (error && typeof error === "object" && "status" in error && error.status === 404) return failure(404, "아직 준비되지 않았거나 찾을 수 없는 결과 파일입니다.");
          throw error;
        }
      }
      try { return jsonResponse(await deps.loadSnapshot(auth.db, id)); }
      catch (error) {
        if (error && typeof error === "object" && "status" in error && error.status === 404) return failure(404, "접수를 찾을 수 없습니다.");
        throw error;
      }
    } catch (error) { return requestFailure(error); }
  }
  async function POST(request: Request, context: Context) {
    try {
      const url = new URL(request.url);
      const isCertificate = url.searchParams.get("action") === "certificate";
      const bytes = await readBoundedDeskBody(request, isCertificate ? SERVER_UPLOAD_MAX_BYTES : 3 * 1024 * 1024);
      const auth = await authenticate(request, bytes);
      if (auth.error) return auth.error;
      const { id } = await context.params;
      if (!uuid.safeParse(id).success) return failure(400, "접수 ID를 확인해주세요.");
      if (isCertificate) {
        const expectedUpdatedAt = url.searchParams.get("expectedUpdatedAt") ?? "";
        const filename = url.searchParams.get("filename") ?? "";
        const requestedId = url.searchParams.get("requestId");
        if (!revision.safeParse(expectedUpdatedAt).success || !filename || (requestedId && requestedId !== auth.requestId)) return failure(400, "필증 파일과 최신 변경 시각을 확인해주세요.");
        const declaredMime = request.headers.get("content-type")?.split(";")[0].trim();
        const saved = await deps.saveCertificate(auth.db, { submissionId: id, actorUserId: auth.actorId, expectedUpdatedAt,
          body: bytes, filename, requestId: auth.requestId,
          declaredMime: declaredMime === "application/octet-stream" ? undefined : declaredMime,
        });
        if (!saved.ok) return failure(saved.status, saved.error);
        return finish(auth.db, id, saved.changed, null, { certificate: { originalName: saved.certificate.originalName, uploadedAt: saved.certificate.uploadedAt } });
      }
      if (url.searchParams.has("action")) return failure(400, "지원하지 않는 작업입니다.");
      if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return failure(415, "JSON 형식으로 요청해주세요.");
      const parsed = bodySchema.safeParse(await Promise.resolve().then(() => JSON.parse(bytes.toString("utf8"))).catch(() => null));
      if (!parsed.success) return failure(400, "심의 입력값과 최신 변경 시각을 확인해주세요.");
      const body = parsed.data;
      if (body.requestId && body.requestId !== auth.requestId) return failure(400, "요청 식별자가 일치하지 않습니다.");
      if (body.operation === "station") {
        const saved = await deps.saveStation(auth.db, { ...body, reviewId: body.reviewId ?? undefined, actorUserId: auth.actorId, submissionId: id });
        if (!saved.ok || !saved.row) return saveFailure(saved);
        return finish(auth.db, id, saved.changed === true, null);
      }
      if (body.operation === "bulk-stations") {
        const saved = await deps.saveStations(auth.db, { ...body, actorUserId: auth.actorId, submissionId: id });
        if (!saved.ok) return saveFailure(saved);
        return finish(auth.db, id, saved.changed === true, null, { savedCount: saved.savedCount });
      }
      if (body.operation === "online") {
        const saved = await deps.saveOnline(auth.db, { ...body, actorUserId: auth.actorId, submissionId: id });
        if (!saved.ok) return saveFailure(saved);
        return finish(auth.db, id, saved.changed === true, null);
      }
      const notification = await deps.sendSummary({ submissionId: id, requestId: auth.requestId,
        expectedRevision: body.expectedRevision, expectedUpdatedAt: body.expectedUpdatedAt });
      if (notification.errorCode) return failure(notification.errorCode === "CONFLICT" ? 409 : notification.errorCode === "LOAD_FAILED" ? 503 : 400,
        notification.error ?? "이메일 미리보기를 다시 확인해주세요.", notification.errorCode);
      return finish(auth.db, id, false, notification);
    } catch (error) { return requestFailure(error); }
  }
  return { GET, POST };
}

const purgeBody = z.object({ operation: z.literal("purge"), submissionIds: z.array(uuid).min(1).max(PURGE_BATCH_LIMIT), requestId: uuid });
type StorageDependencies = Pick<Dependencies, "secret" | "createDb"> & {
  loadCandidates: typeof loadPurgeCandidates;
  purge: typeof purgeCustomerFiles;
};
const storageFailure = (error: unknown) => error instanceof Error && error.name === "B2ConfigError"
  ? failure(500, "파일 저장소 설정을 확인할 수 없습니다.")
  : error && typeof error === "object" && "status" in error && error.status === 413
    ? failure(413, "입력 데이터가 허용 크기를 초과했습니다.")
    : failure(500, "삭제 대상을 확인하지 못했습니다. 잠시 후 다시 시도해주세요.");

/** The Mac desk's 저장공간 정리: the same candidates and purge as /admin/storage.
 * Object keys never leave the service; the desk only sees what it lists. */
export function createReviewDeskStorageHandlers(deps: StorageDependencies) {
  async function GET(request: Request) {
    try {
      const auth = await authenticateDeskAdmin(deps, request, await readBoundedDeskBody(request, 0));
      if (auth.error) return auth.error;
      const items = (await deps.loadCandidates(auth.db)).map((candidate) => ({
        submissionId: candidate.submissionId, title: candidate.title, artistName: candidate.artistName, type: candidate.type,
        refunded: candidate.refunded, finishedAt: candidate.finishedAt, fileCount: candidate.files.length, totalBytes: candidate.totalBytes,
      }));
      return jsonResponse({ ok: true, items, batchLimit: PURGE_BATCH_LIMIT });
    } catch (error) { return storageFailure(error); }
  }
  async function POST(request: Request) {
    try {
      const bytes = await readBoundedDeskBody(request, 64 * 1024);
      const auth = await authenticateDeskAdmin(deps, request, bytes);
      if (auth.error) return auth.error;
      if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return failure(415, "JSON 형식으로 요청해주세요.");
      const parsed = purgeBody.safeParse(await Promise.resolve().then(() => JSON.parse(bytes.toString("utf8"))).catch(() => null));
      if (!parsed.success) return failure(400, `삭제할 신청을 1~${PURGE_BATCH_LIMIT}건씩 보내주세요.`);
      if (parsed.data.requestId !== auth.requestId) return failure(400, "요청 식별자가 일치하지 않습니다.");
      return jsonResponse({ ok: true, results: await deps.purge(auth.db, parsed.data.submissionIds, auth.actorId) });
    } catch (error) { return storageFailure(error); }
  }
  return { GET, POST };
}

type IntakeDependencies = Pick<Dependencies, "secret" | "createDb"> & {
  listPackages: typeof listGuestAlbumIntakePackages;
  ensureArtist: (name: string) => Promise<string | null>;
  trackUrl: (guestToken: string) => string;
  revalidate: (submissionId: string) => void;
};

/** 관리자 대리 접수: the desk registers an emailed album review as a guest
 * submission. The signed request ID becomes the guest lookup code, so a
 * retried request returns the submission it already created. */
export function createReviewDeskIntakeHandlers(deps: IntakeDependencies) {
  async function GET(request: Request) {
    try {
      const auth = await authenticateDeskAdmin(deps, request, await readBoundedDeskBody(request, 0));
      if (auth.error) return auth.error;
      return jsonResponse({ ok: true, packages: await deps.listPackages(auth.db) });
    } catch { return failure(500, "패키지 목록을 불러오지 못했습니다. 잠시 후 다시 시도해주세요."); }
  }
  async function POST(request: Request) {
    try {
      const bytes = await readBoundedDeskBody(request, 3 * 1024 * 1024);
      const auth = await authenticateDeskAdmin(deps, request, bytes);
      if (auth.error) return auth.error;
      if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return failure(415, "JSON 형식으로 요청해주세요.");
      const parsed = guestAlbumIntakeSchema.safeParse(await Promise.resolve().then(() => JSON.parse(bytes.toString("utf8"))).catch(() => null));
      if (!parsed.success) return failure(400, "접수 정보를 확인해주세요. 앨범 제목·아티스트·고객 이름과 곡 제목이 필요하고, 이메일과 발매일 형식이 맞아야 합니다.");
      const input = parsed.data;
      if (input.requestId !== auth.requestId) return failure(400, "요청 식별자가 일치하지 않습니다.");
      const { data: pkg, error: packageError } = await auth.db.from("packages").select("price_krw").eq("id", input.packageId).eq("is_active", true).maybeSingle();
      if (packageError) return failure(503, "패키지 정보를 확인하지 못했습니다. 잠시 후 다시 시도해주세요.");
      if (!pkg) return failure(400, "선택한 패키지를 사용할 수 없습니다. 패키지를 다시 선택해주세요.");
      const artistId = await deps.ensureArtist(input.submission.artistName).catch(() => null);
      const record = buildGuestAlbumIntakeRecord(input, artistId);
      const { data, error } = await auth.db.rpc("admin_register_guest_album", {
        p_actor_user_id: auth.actorId, p_guest_token: input.requestId, p_package_id: input.packageId,
        p_amount_krw: getAlbumReviewPriceKrw(Number(pkg.price_krw)), p_paid: input.paid, p_parent: record.parent, p_tracks: record.tracks,
      });
      if (error) {
        const known = guestAlbumIntakeFailure(error.message);
        return known ? failure(known[0], known[1]) : failure(500, "비회원 접수를 등록하지 못했습니다. 잠시 후 다시 시도해주세요.");
      }
      const row = (Array.isArray(data) ? data[0] : data) as { submission_id?: string; created?: boolean } | null;
      if (!row?.submission_id) return failure(500, "비회원 접수를 등록하지 못했습니다. 잠시 후 다시 시도해주세요.");
      try { deps.revalidate(row.submission_id); } catch { /* The submission exists; pages refresh on their own. */ }
      return jsonResponse({ ok: true, created: row.created === true, submissionId: row.submission_id, guestToken: input.requestId, trackUrl: deps.trackUrl(input.requestId), paid: input.paid });
    } catch (error) {
      if (error && typeof error === "object" && "status" in error && error.status === 413) return failure(413, "입력 데이터가 허용 크기를 초과했습니다.");
      return failure(500, "비회원 접수를 등록하지 못했습니다. 잠시 후 다시 시도해주세요.");
    }
  }
  return { GET, POST };
}
