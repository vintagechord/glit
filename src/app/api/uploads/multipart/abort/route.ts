import { NextResponse } from "next/server";
import { z } from "zod";

import {
  abortClaimedMultipartGrant,
  getMultipartGrant,
  getMultipartOwnerKey,
  multipartGrantMatches,
} from "@/lib/multipart-upload-grants";
import { ensureSubmissionOwner } from "@/lib/payments/submission";
import { readBoundedJsonBody } from "@/lib/request-body";
import {
  consumeRateLimit,
  getRequestIdentifier,
} from "@/lib/request-rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const schema = z.object({
  grantId: z.string().uuid(),
  submissionId: z.string().uuid(),
  key: z.string().min(1).max(1024),
  uploadId: z.string().min(1).max(1024),
  guestToken: z.string().min(8).max(120).optional(),
});

export async function POST(request: Request) {
  const requestLimit = consumeRateLimit({
    namespace: "upload-multipart-abort-ip",
    identifier: getRequestIdentifier(request.headers),
    limit: 60,
    windowMs: 60 * 60 * 1_000,
  });
  if (!requestLimit.allowed) {
    return NextResponse.json(
      { error: "업로드 요청이 너무 많습니다. 잠시 후 다시 시도해주세요." },
      {
        status: 429,
        headers: { "Retry-After": String(requestLimit.retryAfterSeconds) },
      },
    );
  }

  const body = await readBoundedJsonBody(request, 16 * 1024);
  if (!body.ok) {
    return NextResponse.json(
      { error: "업로드 정보를 확인해주세요." },
      { status: body.reason === "too_large" ? 413 : 400 },
    );
  }
  const parsed = schema.safeParse(body.value);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "업로드 정보를 확인해주세요." },
      { status: 400 },
    );
  }

  const { grantId, submissionId, key, uploadId, guestToken } = parsed.data;
  const { user, submission, error } = await ensureSubmissionOwner(
    submissionId,
    guestToken,
  );
  if (error === "NOT_FOUND") {
    return NextResponse.json({ error: "접수를 찾을 수 없습니다." }, { status: 404 });
  }
  if (error === "UNAUTHORIZED") {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  if (error === "FORBIDDEN") {
    return NextResponse.json({ error: "접수에 대한 권한이 없습니다." }, { status: 403 });
  }

  const ownerKey = getMultipartOwnerKey({
    submissionUserId: submission?.user_id,
    authenticatedUserId: user?.id,
    guestToken: guestToken ?? submission?.guest_token,
  });
  const grant = await getMultipartGrant(grantId).catch(() => null);
  if (
    !ownerKey ||
    !grant ||
    !multipartGrantMatches(grant, {
      submissionId,
      ownerKey,
      uploadId,
      objectKey: key,
    })
  ) {
    return NextResponse.json({ error: "접수에 대한 권한이 없습니다." }, { status: 403 });
  }

  const admin = createAdminClient();
  const { error: claimError } = await admin.rpc(
    "claim_multipart_upload_abort",
    {
      p_grant_id: grant.id,
      p_submission_id: submissionId,
      p_upload_id: uploadId,
      p_object_key: key,
      p_owner_key: ownerKey,
    },
  );
  if (claimError) {
    return NextResponse.json(
      { error: "이미 종료되었거나 유효하지 않은 업로드입니다." },
      { status: 409 },
    );
  }

  const aborted = await abortClaimedMultipartGrant({
    ...grant,
    status: "ABORTING",
  });
  return NextResponse.json(
    aborted
      ? { ok: true }
      : { error: "스토리지 업로드를 중단하지 못했습니다." },
    { status: aborted ? 200 : 502 },
  );
}
