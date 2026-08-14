import { revalidatePath } from "next/cache";
import { after, NextResponse } from "next/server";
import { z } from "zod";

import { clearDashboardStatusCache } from "@/lib/dashboard-status";
import { partitionGuestCartClaimEntries } from "@/lib/guest-cart-claim";
import { isPaymentInProgressDatabaseError } from "@/lib/payment-group";
import { readBoundedJsonBody } from "@/lib/request-body";
import {
  consumeRateLimit,
  getRequestIdentifier,
} from "@/lib/request-rate-limit";
import {
  cleanupDeletedSubmissionB2Objects,
  loadSubmissionB2ObjectRefs,
} from "@/lib/submission-file-cleanup";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";
import { getServerSessionUser } from "@/lib/supabase/server-user";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const deleteSchema = z.object({
  submissionIds: z.array(z.string().uuid()).min(1).max(100),
  guestTokensBySubmissionId: z
    .record(z.string().uuid(), z.string().min(8).max(120))
    .optional(),
});

const guestCartSchema = z.object({
  guestTokensBySubmissionId: z.record(
    z.string().uuid(),
    z.string().min(8).max(120),
  ),
});

type CartDeleteSubmission = {
  id: string;
  user_id: string | null;
  guest_token: string | null;
  status: string | null;
  payment_status: string | null;
  user_deleted_at: string | null;
};

const cartItemSelect =
  "id, type, status, payment_status, payment_method, title, artist_name, amount_krw, is_oneclick, created_at, updated_at, user_deleted_at, user_id, guest_token, package:packages ( name, station_count )";

const cartStatuses = new Set(["SUBMITTED", "WAITING_PAYMENT"]);
const cartPaymentFilter =
  "payment_status.is.null,payment_status.in.(UNPAID,PAYMENT_PENDING)";

const isCartSubmission = (row: CartDeleteSubmission) =>
  row.payment_status !== "PAID" &&
  cartStatuses.has(String(row.status ?? ""));

const hasGuestOwnership = (
  row: CartDeleteSubmission,
  guestTokensBySubmissionId: Record<string, string>,
) =>
  !row.user_id &&
  Boolean(row.guest_token) &&
  guestTokensBySubmissionId[row.id] === row.guest_token;

const getCartRateLimitResponse = (
  request: Request,
  namespace: string,
  limit: number,
) => {
  const result = consumeRateLimit({
    namespace,
    identifier: getRequestIdentifier(request.headers),
    limit,
    windowMs: 15 * 60 * 1_000,
  });
  return result.allowed
    ? null
    : NextResponse.json(
        { error: "장바구니 요청이 너무 많습니다. 잠시 후 다시 시도해주세요." },
        {
          status: 429,
          headers: { "Retry-After": String(result.retryAfterSeconds) },
        },
      );
};

export async function POST(request: Request) {
  const rateLimitResponse = getCartRateLimitResponse(
    request,
    "cart-items-read-ip",
    120,
  );
  if (rateLimitResponse) return rateLimitResponse;

  const body = await readBoundedJsonBody(request, 32 * 1024);
  if (!body.ok) {
    return NextResponse.json(
      { error: "장바구니 정보를 확인해주세요." },
      { status: body.reason === "too_large" ? 413 : 400 },
    );
  }
  const parsed = guestCartSchema.safeParse(body.value);
  const entries = parsed.success
    ? Object.entries(parsed.data.guestTokensBySubmissionId)
    : [];

  if (!parsed.success || entries.length < 1 || entries.length > 100) {
    return NextResponse.json(
      { error: "장바구니 정보를 확인해주세요." },
      { status: 400 },
    );
  }

  const guestTokensBySubmissionId = Object.fromEntries(entries);
  const submissionIds = entries.map(([submissionId]) => submissionId);
  const guestTokens = Array.from(new Set(entries.map(([, token]) => token)));
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("submissions")
    .select(cartItemSelect)
    .in("id", submissionIds)
    .is("user_id", null)
    .in("guest_token", guestTokens)
    .in("status", ["SUBMITTED", "WAITING_PAYMENT"])
    .or(cartPaymentFilter)
    .is("user_deleted_at", null)
    .order("updated_at", { ascending: false });

  if (error) {
    console.error("[CartItems] guest load failed", {
      code: error.code,
      message: error.message,
    });
    return NextResponse.json(
      { error: "장바구니 항목을 불러오지 못했습니다." },
      { status: 500 },
    );
  }

  const rows = ((data ?? []) as unknown[]).map(
    (row) => row as CartDeleteSubmission & Record<string, unknown>,
  );
  const items = rows
    .filter(
      (row) =>
        isCartSubmission(row) &&
        hasGuestOwnership(row, guestTokensBySubmissionId),
    )
    .map((row) =>
      Object.fromEntries(
        Object.entries(row).filter(
          ([key]) => key !== "guest_token" && key !== "user_id",
        ),
      ),
    );
  const validIds = new Set(items.map((item) => String(item.id)));

  return NextResponse.json({
    items,
    invalidSubmissionIds: submissionIds.filter((id) => !validIds.has(id)),
  });
}

export async function PATCH(request: Request) {
  const rateLimitResponse = getCartRateLimitResponse(
    request,
    "cart-items-claim-ip",
    30,
  );
  if (rateLimitResponse) return rateLimitResponse;

  const supabase = await createServerSupabase();
  const user = await getServerSessionUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const body = await readBoundedJsonBody(request, 32 * 1024);
  if (!body.ok) {
    return NextResponse.json(
      { error: "연결할 비회원 장바구니 정보를 확인해주세요." },
      { status: body.reason === "too_large" ? 413 : 400 },
    );
  }
  const parsed = guestCartSchema.safeParse(body.value);
  const entries = parsed.success
    ? Object.entries(parsed.data.guestTokensBySubmissionId)
    : [];
  if (!parsed.success || entries.length < 1 || entries.length > 100) {
    return NextResponse.json(
      { error: "연결할 비회원 장바구니 정보를 확인해주세요." },
      { status: 400 },
    );
  }

  const guestTokensBySubmissionId = Object.fromEntries(entries);
  const submissionIds = entries.map(([submissionId]) => submissionId);
  const guestTokens = Array.from(new Set(entries.map(([, token]) => token)));
  const admin = createAdminClient();
  const { data: rows, error: loadError } = await admin
    .from("submissions")
    .select(
      "id, user_id, guest_token, status, payment_status, user_deleted_at",
    )
    .in("id", submissionIds)
    .is("user_id", null)
    .in("guest_token", guestTokens);

  if (loadError) {
    console.error("[CartItems] guest claim lookup failed", loadError);
    return NextResponse.json(
      { error: "비회원 장바구니 항목을 확인하지 못했습니다." },
      { status: 500 },
    );
  }

  const { claimableEntries, invalidSubmissionIds } =
    partitionGuestCartClaimEntries(
      guestTokensBySubmissionId,
      (rows ?? []) as CartDeleteSubmission[],
    );
  const claimableIds = Object.keys(claimableEntries);
  if (claimableIds.length === 0) {
    return NextResponse.json({ claimedIds: [], invalidSubmissionIds });
  }

  const { data: claimedRows, error: claimError } = await admin.rpc(
    "claim_guest_cart_submissions",
    {
      p_user_id: user.id,
      p_entries: claimableEntries,
    },
  );
  if (claimError) {
    console.error("[CartItems] guest claim failed", {
      code: claimError.code,
      message: claimError.message,
    });
    const status =
      claimError.code === "P0001" || claimError.code === "55000" ? 409 : 500;
    return NextResponse.json(
      {
        error:
          status === 409
            ? claimError.code === "55000"
              ? "진행 중인 카드 결제가 있습니다. 결제창을 닫거나 결제를 취소한 뒤 다시 로그인해주세요."
              : "장바구니 항목 상태가 변경되었습니다. 다시 시도해주세요."
            : "비회원 장바구니를 계정에 연결하지 못했습니다.",
        invalidSubmissionIds,
      },
      { status },
    );
  }

  const claimedIds = ((claimedRows ?? []) as Array<{ submission_id: string }>).map(
    (row) => row.submission_id,
  );
  if (claimedIds.length !== claimableIds.length) {
    return NextResponse.json(
      { error: "일부 비회원 장바구니 항목을 연결하지 못했습니다." },
      { status: 500 },
    );
  }

  clearDashboardStatusCache(user.id);
  revalidatePath("/dashboard");
  revalidatePath("/mypage");
  revalidatePath("/dashboard/cart");
  revalidatePath("/mypage/cart");
  revalidatePath("/en/dashboard");
  revalidatePath("/en/mypage");
  revalidatePath("/en/dashboard/cart");
  revalidatePath("/en/mypage/cart");

  return NextResponse.json({
    claimedIds,
    invalidSubmissionIds,
  });
}

export async function DELETE(request: Request) {
  const rateLimitResponse = getCartRateLimitResponse(
    request,
    "cart-items-delete-ip",
    60,
  );
  if (rateLimitResponse) return rateLimitResponse;

  const supabase = await createServerSupabase();
  const user = await getServerSessionUser(supabase);

  const body = await readBoundedJsonBody(request, 32 * 1024);
  if (!body.ok) {
    return NextResponse.json(
      { error: "삭제할 장바구니 항목을 선택해주세요." },
      { status: body.reason === "too_large" ? 413 : 400 },
    );
  }
  const parsed = deleteSchema.safeParse(body.value);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "삭제할 장바구니 항목을 선택해주세요." },
      { status: 400 },
    );
  }

  const submissionIds = Array.from(new Set(parsed.data.submissionIds));
  const guestTokensBySubmissionId =
    parsed.data.guestTokensBySubmissionId ?? {};
  const guestTokens = Array.from(
    new Set(Object.values(guestTokensBySubmissionId)),
  );
  if (
    !user &&
    submissionIds.some((id) => !guestTokensBySubmissionId[id])
  ) {
    return NextResponse.json(
      { error: "장바구니 항목을 삭제할 권한이 없습니다." },
      { status: 403 },
    );
  }

  const admin = createAdminClient();
  let loadQuery = admin
    .from("submissions")
    .select("id, user_id, guest_token, status, payment_status")
    .in("id", submissionIds)
    .or(cartPaymentFilter);
  loadQuery = user
    ? loadQuery.eq("user_id", user.id)
    : loadQuery.is("user_id", null).in("guest_token", guestTokens);
  const { data, error } = await loadQuery;

  if (error) {
    console.error("[CartItems] load failed", error);
    return NextResponse.json(
      { error: "삭제할 장바구니 항목을 확인하지 못했습니다." },
      { status: 500 },
    );
  }

  const rows = ((data ?? []) as unknown[]).map(
    (row) => row as CartDeleteSubmission,
  );
  const invalid =
    rows.length !== submissionIds.length ||
    rows.some(
      (row) =>
        !isCartSubmission(row) ||
        !(user
          ? row.user_id === user.id
          : hasGuestOwnership(row, guestTokensBySubmissionId)),
    );

  if (invalid) {
    return NextResponse.json(
      { error: "삭제할 수 없는 장바구니 항목이 포함되어 있습니다." },
      { status: 409 },
    );
  }

  const { data: hasRequestedPayment, error: requestedPaymentError } =
    await admin.rpc("has_requested_submission_payments", {
      p_submission_ids: submissionIds,
    });
  if (requestedPaymentError) {
    console.error("[CartItems] requested payment check failed", {
      code: requestedPaymentError.code,
      message: requestedPaymentError.message,
      details: requestedPaymentError.details,
      hint: requestedPaymentError.hint,
    });
    return NextResponse.json(
      { error: "진행 중인 결제 정보를 확인하지 못했습니다." },
      { status: 500 },
    );
  }

  if (hasRequestedPayment) {
    return NextResponse.json(
      {
        error:
          "카드 결제가 진행 중인 신청서는 삭제할 수 없습니다. 결제창을 닫거나 결제를 취소한 뒤 다시 시도해주세요.",
      },
      { status: 409 },
    );
  }

  const b2ObjectRefs = await loadSubmissionB2ObjectRefs(admin, submissionIds);

  // All submission relations use ON DELETE CASCADE (migration 0071). Deleting
  // the parent rows in one statement keeps the cleanup atomic and prevents the
  // half-deleted state that a sequence of child-table deletes could leave.
  let deleteQuery = admin
    .from("submissions")
    .delete()
    .in("id", submissionIds)
    .in("status", ["SUBMITTED", "WAITING_PAYMENT"])
    .or(cartPaymentFilter);
  deleteQuery = user
    ? deleteQuery.eq("user_id", user.id)
    : deleteQuery
        .is("user_id", null)
        .in("guest_token", guestTokens);
  const { data: deletedRows, error: deleteError } = await deleteQuery.select(
    "id",
  );

  if (deleteError) {
    console.error("[CartItems] delete failed", {
      code: deleteError.code,
      message: deleteError.message,
      details: deleteError.details,
      hint: deleteError.hint,
    });
    if (isPaymentInProgressDatabaseError(deleteError)) {
      return NextResponse.json(
        {
          error:
            "카드 결제가 진행 중인 신청서는 삭제할 수 없습니다. 결제창을 닫거나 결제를 취소한 뒤 다시 시도해주세요.",
        },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: "장바구니 항목 삭제에 실패했습니다." },
      { status: 500 },
    );
  }

  const deletedIds = (deletedRows ?? []).map((row) => row.id as string);
  if (deletedIds.length > 0 && b2ObjectRefs.length > 0) {
    after(() =>
      cleanupDeletedSubmissionB2Objects(admin, b2ObjectRefs, deletedIds),
    );
  }
  if (deletedIds.length !== submissionIds.length) {
    return NextResponse.json(
      { error: "일부 장바구니 항목이 변경되어 삭제하지 못했습니다." },
      { status: 409 },
    );
  }

  if (user) {
    clearDashboardStatusCache(user.id);
  }

  revalidatePath("/dashboard/cart");
  revalidatePath("/mypage/cart");
  revalidatePath("/en/dashboard/cart");
  revalidatePath("/en/mypage/cart");
  revalidatePath("/dashboard");
  revalidatePath("/mypage");
  revalidatePath("/en/dashboard");
  revalidatePath("/en/mypage");
  revalidatePath("/dashboard/drafts");
  revalidatePath("/mypage/drafts");
  revalidatePath("/en/dashboard/drafts");
  revalidatePath("/en/mypage/drafts");
  for (const id of deletedIds) {
    revalidatePath(`/dashboard/submissions/${id}`);
    revalidatePath(`/mypage/submissions/${id}`);
    revalidatePath(`/en/dashboard/submissions/${id}`);
    revalidatePath(`/en/mypage/submissions/${id}`);
  }

  return NextResponse.json({ ok: true, deletedIds });
}
