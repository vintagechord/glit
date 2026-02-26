import {
  updateKaraokeStatusFormAction,
  updateKaraokePromotionRecommendationStatusFormAction,
} from "@/features/karaoke/actions";
import { AdminSaveToast } from "@/components/admin/save-toast";
import { KaraokeFileButton } from "@/features/karaoke/karaoke-file-button";
import { formatDateTime } from "@/lib/format";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata = {
  title: "노래방 등록 관리",
};

const statusOptions = ["REQUESTED", "IN_REVIEW", "COMPLETED"];
const paymentStatusOptions = ["UNPAID", "PAYMENT_PENDING", "PAID", "REFUNDED"];
const recommendationStatusOptions = ["PENDING", "APPROVED", "REJECTED"];

type KaraokeRequestRow = {
  id: string;
  title: string | null;
  artist: string | null;
  contact: string | null;
  notes: string | null;
  file_path: string | null;
  status: string;
  created_at: string;
  payment_status: string | null;
  payment_method: string | null;
  amount_krw: number | null;
  bank_depositor_name: string | null;
  tj_requested: boolean | null;
  ky_requested: boolean | null;
  guest_name?: string | null;
  guest_email?: string | null;
  guest_phone?: string | null;
};

type KaraokeSearchParamsInput = {
  status?: string | string[];
  saved?: string | string[];
};

const toSingle = (value?: string | string[]) => {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
};

export default async function AdminKaraokePage({
  searchParams,
}: {
  searchParams?: Promise<KaraokeSearchParamsInput>;
}) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const statusFilter = toSingle(resolvedSearchParams?.status).trim();
  const savedFlag = toSingle(resolvedSearchParams?.saved).trim();
  const currentParams = new URLSearchParams();
  if (statusFilter) {
    currentParams.set("status", statusFilter);
  }
  const currentPageHref = currentParams.toString()
    ? `/admin/karaoke?${currentParams.toString()}`
    : "/admin/karaoke";

  const supabase = await createServerSupabase();
  const baseSelect =
    "id, title, artist, contact, notes, file_path, status, created_at, payment_status, payment_method, amount_krw, bank_depositor_name, tj_requested, ky_requested";
  const guestSelect = `${baseSelect}, guest_name, guest_email, guest_phone`;

  const buildQuery = (selectFields: string) => {
    let query = supabase
      .from("karaoke_requests")
      .select(selectFields)
      .order("created_at", { ascending: false });

    if (statusFilter) {
      query = query.eq("status", statusFilter);
    }

    return query;
  };

  let hasGuestColumns = true;
  let requests: KaraokeRequestRow[] = [];
  let requestsError = null as { message?: string; code?: string } | null;
  const guestResult = await buildQuery(guestSelect);
  requestsError = guestResult.error ?? null;
  requests = (guestResult.data ?? []) as unknown as KaraokeRequestRow[];

  if (
    requestsError?.message?.toLowerCase().includes("guest_name") ||
    requestsError?.code === "42703"
  ) {
    hasGuestColumns = false;
    const fallback = await buildQuery(baseSelect);
    requests = (fallback.data ?? []) as unknown as KaraokeRequestRow[];
    requestsError = fallback.error ?? null;
  }

  const { data: recommendations } = await supabase
    .from("karaoke_promotion_recommendations")
    .select(
      "id, status, created_at, proof_path, recommender_user_id, promotion:karaoke_promotions ( id, credits_balance, submission:submissions ( title, artist_name ) )",
    )
    .order("created_at", { ascending: false })
    .limit(30);

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-12">
      {savedFlag ? <AdminSaveToast message="저장되었습니다." /> : null}
      <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
        Admin
      </p>
      <h1 className="font-display mt-2 text-3xl text-foreground">
        노래방 등록 관리
      </h1>

      <form className="mt-6 flex flex-wrap items-center gap-3 rounded-[28px] border border-border/60 bg-card/80 p-4">
        <select
          name="status"
          defaultValue={statusFilter}
          className="rounded-2xl border border-border/70 bg-background px-4 py-2 text-sm"
        >
          <option value="">전체 상태</option>
          {statusOptions.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded-full bg-foreground px-5 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-background"
        >
          필터 적용
        </button>
      </form>

      <div className="mt-6 space-y-4">
        {requestsError ? (
          <div className="rounded-2xl border border-dashed border-red-500/40 bg-red-500/10 px-4 py-3 text-xs text-red-600">
            요청 목록을 불러오지 못했습니다. ({requestsError.message})
          </div>
        ) : requests && requests.length > 0 ? (
          requests.map((request) => (
            <div
              key={request.id}
              className="rounded-2xl border border-border/60 bg-card/80 p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    {request.title}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {request.artist ?? "-"} · {request.contact}
                    {hasGuestColumns && request.guest_name ? " · 비회원" : ""}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    결제: {request.payment_status} · 방식:{" "}
                    {request.payment_method} · 금액:{" "}
                    {request.amount_krw?.toLocaleString() ?? "-"}원
                  </p>
                  {request.bank_depositor_name && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      입금자명: {request.bank_depositor_name}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">
                    태진 {request.tj_requested ? "요청" : "미요청"} · 금영{" "}
                    {request.ky_requested ? "요청" : "미요청"}
                  </p>
                </div>
                <p className="text-xs text-muted-foreground">
                  {formatDateTime(request.created_at)}
                </p>
              </div>
              {hasGuestColumns && request.guest_name && (
                <p className="mt-2 text-xs text-muted-foreground">
                  담당자 {request.guest_name} · {request.guest_phone ?? "-"} ·{" "}
                  {request.guest_email ?? "-"}
                </p>
              )}
              {request.file_path && (
                <div className="mt-2">
                  <KaraokeFileButton
                    kind="request"
                    targetId={request.id}
                    label="첨부파일 확인"
                  />
                </div>
              )}
              <p className="mt-3 text-xs text-muted-foreground">
                {request.notes ?? "요청 사항 없음"}
              </p>
              <form
                action={updateKaraokeStatusFormAction}
                className="mt-4 flex flex-wrap items-center gap-3"
              >
                <input type="hidden" name="requestId" value={request.id} />
                <input type="hidden" name="redirectTo" value={currentPageHref} />
                <select
                  name="status"
                  defaultValue={request.status}
                  className="rounded-2xl border border-border/70 bg-background px-4 py-2 text-xs"
                >
                  {statusOptions.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
                <select
                  name="paymentStatus"
                  defaultValue={request.payment_status ?? "UNPAID"}
                  className="rounded-2xl border border-border/70 bg-background px-4 py-2 text-xs"
                >
                  {paymentStatusOptions.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  className="rounded-full bg-foreground px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-background"
                >
                  상태 저장
                </button>
              </form>
            </div>
          ))
        ) : (
          <div className="rounded-2xl border border-dashed border-border/60 bg-background/70 px-4 py-6 text-xs text-muted-foreground">
            요청이 없습니다.
          </div>
        )}
      </div>

      <div className="mt-10">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
          추천 관리
        </p>
        <h2 className="font-display mt-2 text-2xl text-foreground">
          추천 인증 관리
        </h2>
        <div className="mt-6 space-y-4">
          {recommendations && recommendations.length > 0 ? (
            recommendations.map((recommendation) => (
              <div
                key={recommendation.id}
                className="rounded-2xl border border-border/60 bg-card/80 p-4"
              >
                {(() => {
                  const promotion = Array.isArray(recommendation.promotion)
                    ? recommendation.promotion[0]
                    : recommendation.promotion;
                  const submission = Array.isArray(promotion?.submission)
                    ? promotion?.submission[0]
                    : promotion?.submission;
                  return (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      {submission?.title ?? "제목 미입력"} ·{" "}
                      {submission?.artist_name ?? "-"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      추천자: {recommendation.recommender_user_id ?? "-"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      노출 크레딧: {promotion?.credits_balance ?? "-"}
                    </p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {formatDateTime(recommendation.created_at)}
                  </p>
                </div>
              );
            })()}
                {recommendation.proof_path && (
                  <div className="mt-2">
                    <KaraokeFileButton
                      kind="recommendation"
                      targetId={recommendation.id}
                      label="인증샷 확인"
                    />
                  </div>
                )}
                <form
                  action={updateKaraokePromotionRecommendationStatusFormAction}
                  className="mt-4 flex flex-wrap items-center gap-3"
                >
                  <input
                    type="hidden"
                    name="recommendationId"
                    value={recommendation.id}
                  />
                  <input type="hidden" name="redirectTo" value={currentPageHref} />
                  <select
                    name="status"
                    defaultValue={recommendation.status}
                    className="rounded-2xl border border-border/70 bg-background px-4 py-2 text-xs"
                  >
                    {recommendationStatusOptions.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    className="rounded-full bg-foreground px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-background"
                  >
                    상태 저장
                  </button>
                </form>
              </div>
            ))
          ) : (
            <div className="rounded-2xl border border-dashed border-border/60 bg-background/70 px-4 py-6 text-xs text-muted-foreground">
              추천 요청이 없습니다.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
