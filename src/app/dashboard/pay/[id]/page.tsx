import Link from "next/link";
import { redirect } from "next/navigation";

import { APP_CONFIG } from "@/lib/config";
import { formatCurrency } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";
import { getServerSessionUser } from "@/lib/supabase/server-user";
import { paymentStatusLabelMap } from "@/constants/review-status";
import { PaymentRetryClient } from "./payment-retry-client";

export const dynamic = "force-dynamic";

const uuidPattern =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

type PaymentSubmission = {
  id: string;
  user_id: string | null;
  guest_token?: string | null;
  title: string | null;
  artist_name: string | null;
  amount_krw: number | null;
  payment_status: string | null;
  payment_method: string | null;
  status: string | null;
  type: string | null;
  is_oneclick?: boolean | null;
};

function PaymentPageMessage({
  kicker = "결제하기",
  title,
  description,
  requestId,
  actionHref = "/dashboard/history",
  actionLabel = "나의 심의 내역으로",
}: {
  kicker?: string;
  title: string;
  description: string;
  requestId?: string;
  actionHref?: string;
  actionLabel?: string;
}) {
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-12">
      <div className="rounded-[10px] border-2 border-[#111111] bg-card p-8 shadow-[8px_8px_0_#111111] dark:border-[#f2cf27] dark:shadow-[8px_8px_0_#f2cf27]">
        <p className="bauhaus-kicker">{kicker}</p>
        <h1 className="mt-4 text-2xl font-black text-foreground">{title}</h1>
        <p className="mt-3 rounded-[8px] border-2 border-[#d9362c] bg-[#d9362c]/10 px-4 py-3 text-sm font-semibold text-[#d9362c]">
          {description}
        </p>
        {requestId ? (
          <div className="mt-3 rounded-[8px] border-2 border-border bg-background/70 px-4 py-3 text-xs text-muted-foreground">
            요청 ID: {requestId}
          </div>
        ) : null}
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href={actionHref}
            className="rounded-[8px] border-2 border-border px-4 py-2 text-xs font-black uppercase tracking-normal text-foreground transition hover:border-foreground"
          >
            {actionLabel}
          </Link>
          <a
            href={`mailto:${APP_CONFIG.supportEmail}`}
            className="bauhaus-button px-4 py-2 text-xs uppercase"
          >
            문의하기
          </a>
        </div>
      </div>
    </div>
  );
}

export default async function PayPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ guestToken?: string | string[] | undefined }>;
}) {
  const { id } = await params;
  const resolvedSearchParams = (await searchParams) ?? {};
  const guestTokenRaw = Array.isArray(resolvedSearchParams.guestToken)
    ? resolvedSearchParams.guestToken[0]
    : resolvedSearchParams.guestToken;
  const guestToken =
    typeof guestTokenRaw === "string" ? guestTokenRaw.trim() : "";
  const rawId = id?.trim();
  const submissionId = rawId && uuidPattern.test(rawId) ? rawId : "";

  if (!submissionId) {
    return (
      <PaymentPageMessage
        title="유효하지 않은 접수 ID입니다."
        description="결제를 다시 진행할 접수 ID를 확인할 수 없습니다. 신청 내역에서 결제하기를 다시 눌러주세요."
        requestId={rawId || "입력 없음"}
      />
    );
  }

  const supabase = await createServerSupabase();
  const user = await getServerSessionUser(supabase);

  const admin = createAdminClient();
  const { data: submission, error } = await admin
    .from("submissions")
    .select(
      "id, user_id, guest_token, title, artist_name, amount_krw, payment_status, payment_method, status, type, is_oneclick",
    )
    .eq("id", submissionId)
    .maybeSingle();

  if (error || !submission) {
    return (
      <PaymentPageMessage
        title="접수 내역을 찾을 수 없습니다."
        description="결제를 다시 진행할 신청 내역을 불러오지 못했습니다. 신청 내역에서 다시 시도해주세요."
        requestId={submissionId}
      />
    );
  }

  const paymentSubmission = submission as PaymentSubmission;
  const hasUserAccess =
    Boolean(paymentSubmission.user_id) &&
    Boolean(user) &&
    paymentSubmission.user_id === user?.id;
  const hasGuestAccess =
    !paymentSubmission.user_id &&
    Boolean(paymentSubmission.guest_token) &&
    Boolean(guestToken) &&
    paymentSubmission.guest_token === guestToken;

  if (!hasUserAccess && !hasGuestAccess) {
    if (!user && !guestToken) {
      redirect(
        `/login?next=${encodeURIComponent(`/dashboard/pay/${submissionId}`)}`,
      );
    }

    return (
      <PaymentPageMessage
        title="접수 권한이 없습니다."
        description="이 접수를 결제할 수 있는 계정으로 로그인했거나 비회원 조회 링크로 접근했는지 확인해주세요."
        requestId={submissionId}
      />
    );
  }

  const amountLabel = paymentSubmission.amount_krw
    ? formatCurrency(paymentSubmission.amount_krw)
    : "미정";
  const paymentStatusLabel =
    paymentSubmission.payment_status &&
    paymentSubmission.payment_status in paymentStatusLabelMap
      ? paymentStatusLabelMap[
          paymentSubmission.payment_status as keyof typeof paymentStatusLabelMap
        ]
      : paymentSubmission.payment_status === "UNPAID"
        ? "미결제"
        : "미결제";
  const isPaid = paymentSubmission.payment_status === "PAID";
  const isCardPayment = paymentSubmission.payment_method !== "BANK";
  const paymentContext =
    paymentSubmission.type === "ALBUM"
      ? paymentSubmission.is_oneclick
        ? "oneclick"
        : "music"
      : "mv";
  const detailHref = hasGuestAccess
    ? `/track/${encodeURIComponent(guestToken)}`
    : `/dashboard/submissions/${paymentSubmission.id}`;
  const successHref = `${detailHref}?payment=success`;

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <div className="rounded-[10px] border-2 border-[#111111] bg-card p-8 shadow-[8px_8px_0_#111111] dark:border-[#f2cf27] dark:shadow-[8px_8px_0_#f2cf27]">
        <p className="bauhaus-kicker">
          결제하기
        </p>
        <h1 className="mt-4 text-2xl font-black text-foreground">
          {paymentSubmission.title || "제목 미입력"}
        </h1>
        <p className="mt-1 text-sm font-semibold text-muted-foreground">
          {paymentSubmission.artist_name || "아티스트 미입력"}
        </p>

        <div className="mt-6 grid gap-4 rounded-[8px] border-2 border-border bg-background/70 p-4 text-sm text-foreground">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black uppercase tracking-normal text-muted-foreground">
              결제 상태
            </span>
            <span className="rounded-[6px] border-2 border-[#111111] bg-[#f2cf27] px-3 py-1 text-[11px] font-black uppercase tracking-normal text-black">
              {paymentStatusLabel}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs font-black uppercase tracking-normal text-muted-foreground">
              결제 금액
            </span>
            <span className="text-base font-black">{amountLabel}원</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs font-black uppercase tracking-normal text-muted-foreground">
              결제 방식
            </span>
            <span className="text-sm">
              {paymentSubmission.payment_method === "CARD"
                ? "카드"
                : paymentSubmission.payment_method === "BANK"
                  ? "무통장 입금"
                  : "결제 대기"}
            </span>
          </div>
        </div>

        {isPaid ? (
          <div className="mt-6 rounded-[8px] border-2 border-[#1f7a5a] bg-[#1f7a5a]/10 p-4 text-sm font-semibold text-[#1f7a5a]">
            결제가 완료된 접수입니다.
          </div>
        ) : isCardPayment ? (
          <div className="mt-6 rounded-[8px] border-2 border-border bg-background/80 p-4 text-sm text-foreground">
            <p className="text-xs font-black uppercase tracking-normal text-muted-foreground">
              카드 결제
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              접수 내용은 유지되어 있습니다. 아래 버튼으로 이니시스 결제 모듈을 다시 열어 결제를 완료할 수 있습니다.
            </p>
            <div className="mt-4">
              <PaymentRetryClient
                submissionId={paymentSubmission.id}
                context={paymentContext}
                guestToken={hasGuestAccess ? guestToken : undefined}
                detailHref={detailHref}
                successHref={successHref}
              />
            </div>
          </div>
        ) : (
          <div className="mt-6 rounded-[8px] border-2 border-border bg-background/80 p-4 text-sm text-foreground">
            <p className="text-xs font-black uppercase tracking-normal text-muted-foreground">
              무통장 입금 안내
            </p>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <div>
                <p className="text-[11px] font-black uppercase tracking-normal text-muted-foreground">
                  은행
                </p>
                <p className="mt-1 font-semibold">{APP_CONFIG.bankName}</p>
              </div>
              <div>
                <p className="text-[11px] font-black uppercase tracking-normal text-muted-foreground">
                  계좌번호
                </p>
                <p className="mt-1 font-semibold">{APP_CONFIG.bankAccount}</p>
              </div>
              <div>
                <p className="text-[11px] font-black uppercase tracking-normal text-muted-foreground">
                  예금주
                </p>
                <p className="mt-1 font-semibold">{APP_CONFIG.bankHolder}</p>
              </div>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              입금 후 문의하기로 알려주시면 확인을 빠르게 도와드립니다.
            </p>
          </div>
        )}

        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href={hasGuestAccess ? detailHref : "/dashboard"}
            className="rounded-[8px] border-2 border-border px-4 py-2 text-xs font-black uppercase tracking-normal text-foreground transition hover:border-foreground"
          >
            {hasGuestAccess ? "접수 상세로" : "접수 현황으로"}
          </Link>
          <a
            href={`mailto:${APP_CONFIG.supportEmail}`}
            className="bauhaus-button px-4 py-2 text-xs uppercase"
          >
            문의하기
          </a>
        </div>
      </div>
    </div>
  );
}
