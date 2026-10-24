import { createHash, randomUUID } from "node:crypto";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import type { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";
import { abortMultipartUpload, completeMultipartUpload, createMultipartUpload, getB2Config, headObject, presignGetUrl, presignUploadPart, sanitizeFileName } from "@/lib/b2";
import { abortClaimedMultipartGrant, cleanupExpiredMultipartGrants, createMultipartGrant, getMultipartGrant, getMultipartOwnerKey, getMultipartPartSize } from "@/lib/multipart-upload-grants";
import { isSupplementFilenameAllowed, matchesSupplementSignature, SUPPLEMENT_PART_BYTES, supplementActionSchema, supplementMimeType } from "./model";
import { sendSubmissionUpdateEmail } from "@/lib/email";
import { resolveSubmissionNotificationRecipient } from "@/lib/admin/notification-recipient";
import { sendKakaoOfficialNotification } from "@/lib/kakao";
import { buildUrl, getBaseUrl } from "@/lib/url";

export class SupplementError extends Error {
  constructor(message: string, public status = 409) { super(message); }
}

type SupplementSubmission = { id: string; user_id: string | null; guest_token: string | null; payment_status: string; type: string };
export async function getSupplementContext(submissionId: string, request: Request) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  const isAdmin = user ? (await supabase.rpc("is_admin")).data === true : false;
  const guestToken = (request.headers.get("X-Submission-Guest-Token") || request.headers.get("x-guest-token") || "").trim();
  if (!user && guestToken.length < 8) throw new SupplementError("로그인하거나 올바른 조회 코드로 접근해주세요.", 401);
  if (guestToken.length > 120) throw new SupplementError("조회 코드를 확인해주세요.", 403);
  const db = createAdminClient();
  const select = "id,user_id,guest_token,payment_status,type";
  let submission: SupplementSubmission | null = null;
  if (isAdmin || user) {
    let query = db.from("submissions").select(select).eq("id", submissionId);
    if (!isAdmin) query = query.eq("user_id", user!.id);
    const result = await query.maybeSingle();
    if (result.error) throw new SupplementError("신청 정보를 확인할 수 없습니다.", 503);
    submission = result.data;
  }
  if (!submission && guestToken.length >= 8) {
    const result = await db.from("submissions").select(select).eq("id", submissionId).is("user_id", null).eq("guest_token", guestToken).maybeSingle();
    if (result.error) throw new SupplementError("신청 정보를 확인할 수 없습니다.", 503);
    submission = result.data;
  }
  if (!submission) throw new SupplementError("신청에 대한 접근 권한이 없습니다.", 403);
  return { db, submission, userId: user?.id ?? null, isAdmin, guestToken: submission.user_id ? null : guestToken };
}
type Context = Awaited<ReturnType<typeof getSupplementContext>>;

const messages: Record<string, string> = {
  SUPPLEMENT_NOT_FOUND: "보완 요청을 찾을 수 없습니다.",
  SUPPLEMENT_FORBIDDEN: "보완 자료에 대한 권한이 없습니다.",
  SUPPLEMENT_PAYMENT_REQUIRED: "결제 완료된 신청에만 보완 자료를 제출할 수 있습니다.",
  SUPPLEMENT_STATE_CONFLICT: "보완 상태가 변경되었습니다. 새로고침 후 확인해주세요.",
  SUPPLEMENT_FILES_REQUIRED: "완료된 파일을 한 개 이상 준비하고 진행 중인 업로드를 완료하거나 취소해주세요.",
  SUPPLEMENT_FILE_LIMIT: "한 번에 보완 파일을 최대 20개까지 제출할 수 있습니다.",
  SUPPLEMENT_NOTE_REQUIRED: "요청 자료 또는 재보완 사유를 입력해주세요.",
  SUPPLEMENT_NOTIFY_BUSY: "안내를 보내는 중이거나 방금 발송을 요청했습니다. 1분 뒤 결과를 확인해주세요.",
};

async function mutate(context: Context, action: string, options: { requestId?: string; fileId?: string; note?: string; file?: Record<string, unknown> } = {}) {
  const { data, error } = await context.db.rpc("mutate_submission_supplement", {
    p_submission_id: context.submission.id,
    p_action: action,
    p_actor_user_id: context.userId,
    p_guest_token: context.guestToken,
    p_request_id: options.requestId ?? null,
    p_file_id: options.fileId ?? null,
    p_note: options.note ?? "",
    p_file: options.file ?? {},
  });
  if (error) {
    const code = Object.keys(messages).find((key) => error.message?.includes(key));
    throw new SupplementError(code ? messages[code] : "보완 자료를 저장할 수 없습니다. 잠시 후 다시 시도해주세요.", code === "SUPPLEMENT_FORBIDDEN" ? 403 : code ? 409 : 503);
  }
  return data as Record<string, unknown>;
}

export async function listSupplements(context: Context) {
  const { data, error } = await context.db.from("submission_supplement_requests").select(`id,note,status,created_at,updated_at,
    revisions:submission_supplement_revisions(id,revision_no,status,note,review_note,created_at,submitted_at,reviewed_at,
      files:submission_supplement_files(id,original_name,size_bytes,mime_type,status,created_at,verified_at)
      ${context.isAdmin ? ",notifications:submission_supplement_notifications(id,state_key,attempts,outcome,last_attempt_at,completed_at)" : ""})`)
    .eq("submission_id", context.submission.id).order("created_at", { ascending: true });
  if (error) throw new SupplementError("보완 자료 기능을 불러올 수 없습니다. 관리자에게 문의해주세요.", 503);
  return { requests: data ?? [] };
}

async function findRequest(context: Context, requestId: string) {
  const { data, error } = await context.db.from("submission_supplement_requests").select("id,status").eq("id", requestId).eq("submission_id", context.submission.id).maybeSingle();
  if (error || !data) throw new SupplementError("보완 요청을 찾을 수 없습니다.", 404);
  return data as { id: string; status: string };
}

async function findFile(context: Context, fileId: string) {
  const { data: file, error } = await context.db.from("submission_supplement_files").select("id,revision_id,grant_id,original_name,size_bytes,mime_type,object_key,status").eq("id", fileId).maybeSingle();
  if (error || !file) throw new SupplementError("보완 파일을 찾을 수 없습니다.", 404);
  const { data: revision, error: revisionError } = await context.db.from("submission_supplement_revisions").select("id,request_id,status").eq("id", file.revision_id).maybeSingle();
  if (revisionError || !revision) throw new SupplementError("보완 파일을 찾을 수 없습니다.", 404);
  const request = await findRequest(context, revision.request_id);
  return { file, revision, request };
}

export async function performSupplementAction(context: Context, input: z.infer<typeof supplementActionSchema>) {
  if (input.action === "notify") return notifySupplement(context, input.requestId);
  if (input.action === "request" || input.action === "review") {
    if (!context.isAdmin) throw new SupplementError("관리자 권한이 필요합니다.", 403);
    const saved = await mutate(context, input.action === "request" ? "request" : input.decision === "ACCEPTED" ? "accept" : "reject", {
      requestId: "requestId" in input ? input.requestId : undefined, note: input.note,
    });
    const requestId = input.action === "request" ? saved.requestId : input.requestId;
    // The mutation has committed. Notification failures must not claim that the
    // request/review was rolled back or cause a duplicate request on retry.
    try {
      if (typeof requestId !== "string") throw new Error("Missing request id");
      return { ...saved, ...await notifySupplement(context, requestId) };
    } catch {
      return { ...saved, warning: "보완 상태는 저장되었지만 이메일 안내를 완료하지 못했습니다. 발송 내역을 확인하거나 보완 안내 보내기를 다시 눌러주세요." };
    }
  }
  if (input.action === "download") {
    const { file } = await findFile(context, input.fileId);
    if (file.status !== "VERIFIED") throw new SupplementError("전송 확인이 완료된 파일만 다운로드할 수 있습니다.");
    return { url: await presignGetUrl(file.object_key, 300) };
  }
  // Administrator review never grants permission to upload on another user's behalf.
  const ownsSubmission = context.submission.user_id
    ? context.submission.user_id === context.userId
    : Boolean(context.guestToken && context.guestToken === context.submission.guest_token);
  if (!ownsSubmission) throw new SupplementError("신청자만 보완 자료를 제출할 수 있습니다.", 403);
  if (context.submission.payment_status !== "PAID") throw new SupplementError(messages.SUPPLEMENT_PAYMENT_REQUIRED);
  if (input.action === "submit") return mutate(context, "submit", input);
  if (input.action === "init") {
    const request = await findRequest(context, input.requestId);
    if (request.status !== "OPEN") throw new SupplementError(messages.SUPPLEMENT_STATE_CONFLICT);
    const { data: revision, error } = await context.db.from("submission_supplement_revisions").select("id").eq("request_id", request.id).eq("status", "DRAFT").single();
    if (error || !revision) throw new SupplementError(messages.SUPPLEMENT_STATE_CONFLICT);
    const kind = context.submission.type.startsWith("MV") ? "video" : "audio";
    if (!isSupplementFilenameAllowed(input.filename, kind)) throw new SupplementError("요청된 음원·영상 또는 신청서·PDF·가사·ZIP 파일을 선택해주세요.", 400);
    const ownerKey = getMultipartOwnerKey({ submissionUserId: context.submission.user_id, guestToken: context.guestToken });
    if (!ownerKey) throw new SupplementError("신청자 확인이 필요합니다.", 403);
    await cleanupExpiredMultipartGrants().catch(() => undefined);
    // A server-generated namespace cannot be mistaken for a paid original file.
    const key = `${getB2Config().prefix}supplements/${context.submission.id}/${request.id}/${revision.id}/${randomUUID()}/${sanitizeFileName(input.filename)}`;
    const mimeType = supplementMimeType(input.filename);
    const uploadId = await createMultipartUpload({ objectKey: key, contentType: mimeType });
    let grantId: string | null = null;
    try {
      const grant = await createMultipartGrant({ submissionId: context.submission.id, ownerKey, uploadId, objectKey: key, originalName: input.filename, mimeType, uploadKind: kind, declaredSizeBytes: input.sizeBytes, partSizeBytes: SUPPLEMENT_PART_BYTES, partCount: Math.ceil(input.sizeBytes / SUPPLEMENT_PART_BYTES) });
      grantId = grant.id;
      const attached = await mutate(context, "attach", { requestId: request.id, file: { grantId: grant.id } });
      return { ...attached, partSize: grant.part_size_bytes, partCount: grant.part_count };
    } catch (error) {
      // Even if immediate abort fails, a recorded ACTIVE grant is retried by
      // the existing expiry cleanup. No customer object is deleted here.
      const aborted = await abortMultipartUpload({ objectKey: key, uploadId }).then(() => true, () => false);
      if (grantId && aborted) await context.db.from("multipart_upload_grants").update({ status: "ABORTED" }).eq("id", grantId).eq("status", "ACTIVE");
      throw error;
    }
  }
  const { file, revision, request } = await findFile(context, input.fileId);
  if (["complete", "recheck"].includes(input.action) && file.status === "VERIFIED") return { verified: true };
  if (input.action === "abort" && file.status === "ABORTED") return { aborted: true };
  if (request.status !== "OPEN" || revision.status !== "DRAFT" || file.status !== "PENDING") throw new SupplementError(messages.SUPPLEMENT_STATE_CONFLICT);
  const grant = await getMultipartGrant(file.grant_id);
  const ownerKey = getMultipartOwnerKey({ submissionUserId: context.submission.user_id, guestToken: context.guestToken });
  if (!grant || grant.submission_id !== context.submission.id || grant.owner_key !== ownerKey || grant.object_key !== file.object_key) throw new SupplementError("업로드 권한을 확인할 수 없습니다.", 403);
  if (input.action === "abort") {
    await mutate(context, "abort", { fileId: file.id });
    if (["ACTIVE", "COMPLETING", "ABORTING"].includes(grant.status)) await abortClaimedMultipartGrant(grant).catch(() => false);
    return { aborted: true };
  }
  const expiresAt = new Date(grant.expires_at).getTime();
  if (grant.status === "ACTIVE" && (!Number.isFinite(expiresAt) || expiresAt <= Date.now())) throw new SupplementError("업로드 유효 시간이 만료되었습니다. 파일을 취소하고 다시 선택해주세요.", 410);
  if (input.action === "presign") {
    if (grant.status !== "ACTIVE") throw new SupplementError("이미 종료되었거나 확인 중인 업로드입니다.");
    const expiresInSeconds = Math.max(1, Math.min(900, Math.floor((expiresAt - Date.now()) / 1000)));
    const parts = await Promise.all(input.partNumbers.map(async (partNumber) => {
      const contentLength = getMultipartPartSize(grant, partNumber);
      if (!contentLength) throw new SupplementError("파일 조각 번호가 올바르지 않습니다.", 400);
      return { partNumber, url: await presignUploadPart({ objectKey: grant.object_key, uploadId: grant.upload_id, partNumber, contentLength, expiresInSeconds }) };
    }));
    return { parts, expiresInSeconds };
  }
  if (input.action === "complete" || input.action === "recheck") {
    if (grant.status === "ACTIVE") {
      if (input.action === "recheck") throw new SupplementError("전송 완료 요청 전인 파일입니다. 전송을 취소한 뒤 다시 선택해주세요.");
      const { error } = await context.db.rpc("claim_multipart_upload_grant", { p_grant_id: grant.id, p_submission_id: context.submission.id, p_upload_id: grant.upload_id, p_object_key: grant.object_key, p_owner_key: ownerKey, p_part_numbers: input.parts.map((part) => part.partNumber) });
      if (error) throw new SupplementError("업로드 조각 또는 유효 시간을 확인해주세요.");
      await completeMultipartUpload({ objectKey: grant.object_key, uploadId: grant.upload_id, parts: input.parts });
    } else if (grant.status !== "COMPLETING") {
      throw new SupplementError("이미 종료된 업로드입니다. 파일을 다시 선택해주세요.");
    }
    // Reconcile an uncertain completion without deleting its object. Explicit
    // abort can retire this revision's pending file if no object arrived.
    const head = await headObject(grant.object_key);
    if (head.ContentLength !== grant.declared_size_bytes) {
      await mutate(context, "invalidate", { fileId: file.id });
      throw new SupplementError("업로드된 파일 크기가 일치하지 않습니다. 올바른 파일을 다시 선택해주세요.", 400);
    }
    const { client, bucket } = getB2Config();
    const prefix = await client.send(new GetObjectCommand({ Bucket: bucket, Key: grant.object_key, Range: "bytes=0-511" }));
    if (!prefix.ContentLength || prefix.ContentLength > 512) {
      await prefix.Body?.transformToWebStream().cancel().catch(() => undefined);
      throw new SupplementError("파일 형식을 확인할 수 없습니다. 전송 확인을 다시 시도해주세요.", 503);
    }
    const bytes = await prefix.Body?.transformToByteArray();
    if (!bytes || !matchesSupplementSignature(file.original_name, bytes)) {
      await mutate(context, "invalidate", { fileId: file.id });
      throw new SupplementError("파일 내용과 확장자가 일치하지 않습니다. 올바른 파일을 다시 선택해주세요.", 400);
    }
    await mutate(context, "verify", { fileId: file.id, file: { sizeBytes: head.ContentLength } });
    return { verified: true };
  }
  throw new SupplementError("지원하지 않는 요청입니다.", 400);
}

type NotificationOutcome = {
  email: "API_ACCEPTED" | "FAILED" | "SKIPPED";
  kakao: "API_ACCEPTED" | "FAILED" | "SKIPPED";
  emailMessageId?: string;
  emailQueued?: boolean;
  emailStatus?: string;
  emailOutboxId?: string;
  kakaoMessageId?: string;
};

async function notifySupplement(context: Context, requestId: string) {
  if (!context.isAdmin) throw new SupplementError("관리자 권한이 필요합니다.", 403);
  const claim = await mutate(context, "notify_claim", { requestId });
  const previous = (claim.outcome ?? {}) as Partial<NotificationOutcome>;
  if (claim.alreadyAccepted) return { notification: { ...previous, alreadyAccepted: true } };
  const { data: submission, error } = await context.db.from("submissions").select("title,artist_name,applicant_email,guest_email,applicant_phone,guest_phone").eq("id", context.submission.id).single();
  if (error || !submission) throw new SupplementError("안내 수신 정보를 확인할 수 없습니다.", 503);
  const { recipient: email, phone } = await resolveSubmissionNotificationRecipient(context.db, {
    ...submission, user_id: context.submission.user_id,
  });
  const headline = claim.state === "ACCEPTED" ? "보완 자료를 수락했습니다." : claim.state === "SUBMITTED" ? "보완 자료를 확인하고 있습니다." : "자료 보완 요청이 있습니다.";
  const summary = claim.state === "ACCEPTED"
    ? "관리자가 보완 자료를 확인하여 수락했습니다. 신청 내역에서 이후 진행 상황을 확인해주세요."
    : claim.state === "SUBMITTED" ? "보완 자료가 제출되어 관리자 확인을 기다리고 있습니다. 신청 내역에서 진행 상황을 확인해주세요."
    : "신청 내역에서 요청한 방송사·트랙·파일과 보완 사유를 확인한 뒤 보완 자료를 제출해주세요.";
  const link = buildUrl(context.submission.guest_token && !context.submission.user_id
    ? `/track/${encodeURIComponent(context.submission.guest_token)}`
    : `/dashboard/submissions/${context.submission.id}`, getBaseUrl());
  const key = `supplement-${String(claim.notificationId)}`;
  const classify = (result: { ok: boolean; skipped?: boolean }) => result.ok ? "API_ACCEPTED" as const : result.skipped ? "SKIPPED" as const : "FAILED" as const;
  const [emailResult, kakaoResult] = await Promise.all([
    previous.email === "API_ACCEPTED" ? Promise.resolve({ ok: true, messageId: previous.emailMessageId }) : email ? sendSubmissionUpdateEmail({
      email, title: submission.title || "제목 미입력", artist: submission.artist_name,
      kind: context.submission.type.startsWith("MV") ? "MV" : "ALBUM", headline, summary, link,
      subject: "[onside] 보완 자료 안내", idempotencyKey: `${key}-email-${createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 16)}`,
    }).catch(() => ({ ok: false })) : Promise.resolve({ ok: false, skipped: true }),
    previous.kakao === "API_ACCEPTED" ? Promise.resolve({ ok: true, messageId: previous.kakaoMessageId }) : sendKakaoOfficialNotification({ phone, title: headline, message: summary, link, idempotencyKey: `${key}-kakao` }).catch(() => ({ ok: false })),
  ]);
  const outcome: NotificationOutcome = {
    email: classify(emailResult), kakao: classify(kakaoResult),
    ...("messageId" in emailResult && emailResult.messageId ? { emailMessageId: emailResult.messageId } : {}),
    ...("queued" in emailResult && emailResult.queued ? { emailQueued: true } : {}),
    ...("status" in emailResult && typeof emailResult.status === "string" ? { emailStatus: emailResult.status } : {}),
    ...("outboxId" in emailResult && typeof emailResult.outboxId === "string" ? { emailOutboxId: emailResult.outboxId } : {}),
    ...("messageId" in kakaoResult && kakaoResult.messageId ? { kakaoMessageId: kakaoResult.messageId } : {}),
  };
  await mutate(context, "notify_finish", { requestId, file: { notificationId: claim.notificationId, leaseToken: claim.leaseToken, outcome } });
  return { notification: outcome, warning: outcome.email === "API_ACCEPTED" ? undefined
    : outcome.emailStatus === "uncertain" ? "보완 상태는 저장되었습니다. 발송 업체의 접수 여부를 이메일 발송 내역에서 확인해주세요."
    : outcome.emailQueued ? "보완 상태는 저장되었습니다. 이메일은 자동 재시도 예정입니다."
    : "보완 상태는 저장되었지만 이메일을 보내지 못했습니다. 수신처·발송 설정을 확인하고 보완 안내 보내기를 다시 눌러주세요." };
}
