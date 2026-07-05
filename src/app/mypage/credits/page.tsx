import { redirect } from "next/navigation";
import {
  Coins,
  ExternalLink,
  History,
  Ticket,
} from "lucide-react";

import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import {
  CreditActionNotice,
  type CreditActionNoticeState,
} from "@/features/credits/credit-action-notice";
import {
  getCreditRewardStudioUrl,
  getUserCreditSummary,
  type CreditRewardRedemption,
  type StudioReservationRequest,
} from "@/lib/credits";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata = {
  title: "마이페이지 - 나의 크레딧",
};

export const dynamic = "force-dynamic";

type CreditSourceSubmission = {
  id: string;
  title: string | null;
  artist_name: string | null;
  release_date: string | null;
  created_at: string | null;
};

type UserMagazineRequest = {
  id: string;
  target_channel: string | null;
  status: string | null;
  album_title: string | null;
  artist_name: string | null;
  published_url: string | null;
  admin_memo: string | null;
  created_at: string | null;
};

const statusLabels: Record<string, string> = {
  ISSUED: "발행됨",
  USED: "사용 완료",
  CANCELED: "취소됨",
};

const magazineStatusLabels: Record<string, string> = {
  REQUESTED: "요청 접수",
  WRITING: "작성 중",
  PUBLISHED: "사용 완료",
  CANCELED: "취소됨",
};

const studioStatusLabels: Record<string, string> = {
  REQUESTED: "요청 접수",
  APPROVED: "승인/안내 완료",
  CANCELED: "취소됨",
};

const channelLabels: Record<string, string> = {
  DOMESTIC_NEWS: "국내뉴스",
  MEDIA: "미디어",
};

const formatDate = (value?: string | null) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeZone: "Asia/Seoul",
  }).format(date);
};

const formatReservationDateTime = (date?: string | null, time?: string | null) => {
  const dateText = formatDate(date);
  const timeText = time ? ` ${time.slice(0, 5)}` : "";
  return `${dateText}${timeText}`;
};

const getRequestTimestamp = (value?: string | null) => {
  if (!value) return 0;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
};

const getMagazineRequestStatusLabel = (request: UserMagazineRequest) => {
  if (request.status === "PUBLISHED" || request.published_url) {
    return "사용 완료";
  }
  return magazineStatusLabels[request.status ?? ""] ?? request.status ?? "-";
};

const getStudioRequestStatusLabel = (reservation: StudioReservationRequest) => {
  if (reservation.status === "APPROVED" || reservation.approved_at) {
    return "승인/안내 완료";
  }
  return studioStatusLabels[reservation.status] ?? reservation.status;
};

const noticeText = (
  error?: string | string[],
  redeemed?: string | string[],
  studioRequested?: string | string[],
): CreditActionNoticeState | null => {
  const rawError = Array.isArray(error) ? error[0] : error;
  if (rawError) {
    try {
      return { type: "error" as const, text: decodeURIComponent(rawError) };
    } catch {
      return { type: "error" as const, text: rawError };
    }
  }
  const redeemedFlag = Array.isArray(redeemed) ? redeemed[0] : redeemed;
  if (redeemedFlag) {
    return {
      type: "success" as const,
      title: "서비스 이용권 발행 완료",
      text: "크레딧 이용권이 발행되었습니다. 쿠폰코드를 확인해주세요.",
      actionHref: "/mypage/credits#credit-requests",
      actionLabel: "요청 내역 보기",
      clearQueryParams: ["redeemed"],
    };
  }
  const studioRequestedFlag = Array.isArray(studioRequested)
    ? studioRequested[0]
    : studioRequested;
  if (studioRequestedFlag) {
    return {
      type: "success" as const,
      title: "녹음실 사용 신청 완료",
      text:
        "녹음실 예약 요청이 접수되었습니다. 관리자 승인 후 안내 문구가 표시됩니다.\n적어주신 연락처로 녹음실 사용 안내를 드립니다.",
      actionHref: "/mypage/credits#credit-requests",
      actionLabel: "요청 내역 보기",
      clearQueryParams: ["studioRequested"],
    };
  }
  return null;
};

function SummaryCard({
  label,
  value,
  description,
  tone,
}: {
  label: string;
  value: number;
  description: string;
  tone: string;
}) {
  return (
    <div className={`rounded-[10px] border-2 p-5 ${tone}`}>
      <p className="text-[11px] font-black uppercase tracking-normal opacity-70">
        {label}
      </p>
      <p className="mt-2 text-4xl font-black">{value.toLocaleString()}</p>
      <p className="mt-2 text-xs font-semibold leading-5 opacity-75">
        {description}
      </p>
    </div>
  );
}

function MagazineRequestCard({ request }: { request: UserMagazineRequest }) {
  return (
    <div className="rounded-[10px] border-2 border-border bg-background p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-black uppercase tracking-normal text-muted-foreground">
            Magazine
          </p>
          <p className="mt-1 font-black text-foreground">
            {request.album_title ?? "제목 미입력"}
          </p>
        </div>
        <span className="rounded-[6px] bg-[#f2cf27] px-2.5 py-1 text-[11px] font-black text-[#111111]">
          {getMagazineRequestStatusLabel(request)}
        </span>
      </div>
      <p className="mt-2 text-xs font-semibold text-muted-foreground">
        {request.artist_name ?? "-"} ·{" "}
        {channelLabels[request.target_channel ?? ""] ??
          request.target_channel ??
          "-"}{" "}
        · 요청일 {formatDate(request.created_at)}
      </p>
      {request.published_url ? (
        <a
          href={request.published_url}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-[8px] border-2 border-[#111111] bg-[#f2cf27] px-3 py-2 text-xs font-black text-[#111111] transition hover:-translate-y-0.5"
        >
          발행 페이지 보기
          <ExternalLink className="h-4 w-4" aria-hidden="true" />
        </a>
      ) : null}
      {request.admin_memo ? (
        <p className="mt-3 text-xs font-semibold leading-5 text-muted-foreground">
          관리자 메모: {request.admin_memo}
        </p>
      ) : null}
    </div>
  );
}

function StudioReservationCard({
  reservation,
}: {
  reservation: StudioReservationRequest;
}) {
  return (
    <div className="rounded-[10px] border-2 border-border bg-background p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-black uppercase tracking-normal text-muted-foreground">
            Service
          </p>
          <p className="mt-1 font-black text-foreground">
            {reservation.reward_title}
          </p>
        </div>
        <span className="rounded-[6px] bg-[#f2cf27] px-2.5 py-1 text-[11px] font-black text-[#111111]">
          {getStudioRequestStatusLabel(reservation)}
        </span>
      </div>
      <p className="mt-2 text-xs font-semibold text-muted-foreground">
        희망일 {formatReservationDateTime(
          reservation.preferred_date,
          reservation.preferred_time,
        )}{" "}
        · {reservation.contact_phone}
      </p>
      {reservation.status === "APPROVED" && reservation.approved_message ? (
        <div className="mt-3 rounded-[8px] border-2 border-[#111111] bg-[#f2cf27] px-3 py-2 text-xs font-black leading-5 text-[#111111]">
          {reservation.approved_message}
        </div>
      ) : null}
      {reservation.admin_memo ? (
        <p className="mt-3 text-xs font-semibold leading-5 text-muted-foreground">
          관리자 메모: {reservation.admin_memo}
        </p>
      ) : null}
    </div>
  );
}

function RedemptionCard({
  redemption,
}: {
  redemption: CreditRewardRedemption;
}) {
  const studioUrl = getCreditRewardStudioUrl(redemption.reward_title);

  return (
    <div className="rounded-[10px] border-2 border-border bg-background p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-black text-foreground">
            {redemption.reward_title}
          </p>
          <p className="mt-1 text-xs font-semibold text-muted-foreground">
            {redemption.credits_spent}크레딧 사용 · 발행일{" "}
            {formatDate(redemption.issued_at)}
          </p>
        </div>
        <span className="rounded-[6px] bg-[#f2cf27] px-2.5 py-1 text-[11px] font-black text-[#111111]">
          {statusLabels[redemption.status] ?? redemption.status}
        </span>
      </div>
      <div className="mt-4 rounded-[8px] border-2 border-[#111111] bg-[#111111] px-4 py-3 text-white">
        <p className="text-[10px] font-black uppercase tracking-[0.22em] text-white/60">
          Coupon Code
        </p>
        <p className="mt-1 text-2xl font-black tracking-normal">
          {redemption.coupon_code}
        </p>
      </div>
      {studioUrl ? (
        <a
          href={studioUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-[8px] border-2 border-[#111111] bg-background px-4 py-2 text-xs font-black text-foreground transition hover:-translate-y-0.5 hover:bg-[#f2cf27]"
        >
          녹음실 살펴보기
          <ExternalLink className="h-4 w-4" aria-hidden="true" />
        </a>
      ) : null}
      <p className="mt-3 text-xs font-semibold leading-5 text-muted-foreground">
        유효기간 {formatDate(redemption.expires_at)}
        {redemption.used_at ? ` · 사용완료 ${formatDate(redemption.used_at)}` : ""}
        {redemption.admin_memo
          ? ` · 관리자 메모: ${redemption.admin_memo}`
          : ""}
      </p>
    </div>
  );
}

export default async function MyPageCreditsPage({
  searchParams,
}: {
  searchParams?: Promise<{
    error?: string | string[];
    redeemed?: string | string[];
    studioRequested?: string | string[];
  }>;
}) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/mypage/credits");
  }

  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const notice = noticeText(
    resolvedSearchParams?.error,
    resolvedSearchParams?.redeemed,
    resolvedSearchParams?.studioRequested,
  );
  const admin = createAdminClient();

  const [
    summary,
    redemptionsResult,
    submissionsResult,
    magazineRequestsResult,
    studioReservationsResult,
  ] =
    await Promise.all([
      getUserCreditSummary(admin, user.id),
      admin
        .from("credit_reward_redemptions")
        .select(
          "id, user_id, reward_id, reward_title, reward_description, credits_spent, coupon_code, status, expires_at, admin_memo, issued_at, used_at, canceled_at, created_at",
        )
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(50),
      admin
        .from("submissions")
        .select("id, title, artist_name, release_date, created_at")
        .eq("user_id", user.id)
        .eq("type", "ALBUM")
        .eq("payment_status", "PAID")
        .order("created_at", { ascending: false })
        .limit(12),
      admin
        .from("magazine_requests")
        .select(
          "id, target_channel, status, album_title, artist_name, published_url, admin_memo, created_at",
        )
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(30),
      admin
        .from("studio_reservation_requests")
        .select(
          "id, user_id, redemption_id, reward_id, reward_title, service_location, status, preferred_date, preferred_time, duration_hours, contact_name, contact_phone, contact_email, notes, approved_message, admin_memo, approved_at, canceled_at, created_at",
        )
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(30),
    ]);

  const redemptions =
    ((redemptionsResult.data ?? []) as CreditRewardRedemption[]) ?? [];
  const creditSources =
    ((submissionsResult.data ?? []) as CreditSourceSubmission[]) ?? [];
  const magazineRequests =
    ((magazineRequestsResult.data ?? []) as UserMagazineRequest[]) ?? [];
  const studioReservations =
    ((studioReservationsResult.data ?? []) as StudioReservationRequest[]) ?? [];
  const issuedRedemptions = redemptions.filter(
    (redemption) => redemption.status === "ISSUED",
  );
  const usedRedemptions = redemptions.filter(
    (redemption) => redemption.status === "USED",
  );
  const hasCreditRequests =
    magazineRequests.length > 0 || studioReservations.length > 0;
  const creditRequestItems = [
    ...magazineRequests.map((request) => ({
      key: `magazine-${request.id}`,
      type: "magazine" as const,
      createdAt: request.created_at,
      request,
    })),
    ...studioReservations.map((reservation) => ({
      key: `studio-${reservation.id}`,
      type: "studio" as const,
      createdAt: reservation.created_at,
      reservation,
    })),
  ].sort(
    (a, b) =>
      getRequestTimestamp(b.createdAt) - getRequestTimestamp(a.createdAt),
  );

  return (
    <DashboardShell
      title="나의 크레딧"
      description="음반심의 결제 완료 건으로 적립된 크레딧을 매거진 발행이나 서비스 이용권으로 사용할 수 있습니다."
      activeTab="credits"
      contextLabel="마이페이지"
    >
      <div className="space-y-8">
        <CreditActionNotice notice={notice} />

        <section className="rounded-[10px] border-2 border-[#111111] bg-[#fffaf0] p-5 shadow-[5px_5px_0_#111111] dark:border-[#f2cf27] dark:bg-[#171717] dark:shadow-[5px_5px_0_#f2cf27]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="bauhaus-kicker">Credit Wallet</p>
              <h2 className="mt-3 text-2xl font-black text-foreground">
                결제 완료 음반심의 1건 = 1크레딧
              </h2>
              <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-muted-foreground">
                1크레딧으로 매거진을 1회 발행할 수 있습니다. 모은 크레딧은
                치킨 쿠폰처럼 녹음실 이용권 등 서비스 쿠폰으로 교환됩니다.
              </p>
            </div>
            <span className="inline-flex items-center gap-2 rounded-[8px] border-2 border-[#111111] bg-[#f2cf27] px-4 py-2 text-sm font-black text-[#111111]">
              <Coins className="h-4 w-4" aria-hidden="true" />
              보유 크레딧 {summary.available.toLocaleString()}개
            </span>
          </div>
          <div className="mt-6 grid gap-3 md:grid-cols-4">
            <SummaryCard
              label="총 적립"
              value={summary.earned}
              description="결제 완료 및 지급 크레딧"
              tone="border-[#111111] bg-white text-[#111111]"
            />
            <SummaryCard
              label="보유 크레딧"
              value={summary.available}
              description="지금 교환 가능한 잔여 크레딧"
              tone="border-[#111111] bg-[#f2cf27] text-[#111111]"
            />
            <SummaryCard
              label="매거진 사용"
              value={summary.magazineUsed}
              description="매거진 발행 요청에 사용"
              tone="border-border bg-card text-foreground"
            />
            <SummaryCard
              label="이용권 사용"
              value={summary.rewardUsed}
              description="서비스 쿠폰 교환에 사용"
              tone="border-border bg-card text-foreground"
            />
          </div>
        </section>

        <section
          id="credit-requests"
          className="scroll-mt-28 rounded-[10px] border-2 border-border bg-card p-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="bauhaus-kicker">Requests</p>
              <h2 className="mt-3 text-2xl font-black text-foreground">
                크레딧 사용 요청 내역
              </h2>
            </div>
            <span className="rounded-[8px] border-2 border-[#111111] bg-background px-3 py-1 text-xs font-black text-foreground">
              {(magazineRequests.length + studioReservations.length).toLocaleString()}건
            </span>
          </div>

          {hasCreditRequests ? (
            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              {creditRequestItems.map((item) =>
                item.type === "magazine" ? (
                  <MagazineRequestCard key={item.key} request={item.request} />
                ) : (
                  <StudioReservationCard
                    key={item.key}
                    reservation={item.reservation}
                  />
                ),
              )}
            </div>
          ) : (
            <p className="mt-5 rounded-[10px] border-2 border-dashed border-border bg-background p-5 text-sm font-semibold text-muted-foreground">
              아직 크레딧으로 접수한 매거진 발행 또는 서비스 이용권 신청이 없습니다.
            </p>
          )}
        </section>

        <section className="grid gap-6 lg:grid-cols-[1fr_0.86fr]">
          <div className="rounded-[10px] border-2 border-border bg-card p-5">
            <div className="flex items-center gap-2">
              <Ticket className="h-5 w-5 text-[#1556a4]" aria-hidden="true" />
              <h2 className="text-xl font-black text-foreground">
                발행된 이용권
              </h2>
            </div>
            {issuedRedemptions.length > 0 ? (
              <div className="mt-5 space-y-3">
                {issuedRedemptions.map((redemption) => (
                  <RedemptionCard
                    key={redemption.id}
                    redemption={redemption}
                  />
                ))}
              </div>
            ) : (
              <p className="mt-5 rounded-[10px] border-2 border-dashed border-border bg-background p-5 text-sm font-semibold text-muted-foreground">
                아직 발행된 이용권이 없습니다.
              </p>
            )}
          </div>

          <div className="rounded-[10px] border-2 border-border bg-card p-5">
            <div className="flex items-center gap-2">
              <Ticket className="h-5 w-5 text-[#1556a4]" aria-hidden="true" />
              <h2 className="text-xl font-black text-foreground">
                사용완료된 이용권
              </h2>
            </div>
            {usedRedemptions.length > 0 ? (
              <div className="mt-5 space-y-3">
                {usedRedemptions.map((redemption) => (
                  <RedemptionCard
                    key={redemption.id}
                    redemption={redemption}
                  />
                ))}
              </div>
            ) : (
              <p className="mt-5 rounded-[10px] border-2 border-dashed border-border bg-background p-5 text-sm font-semibold text-muted-foreground">
                아직 사용완료된 이용권이 없습니다.
              </p>
            )}
          </div>
        </section>

        <section className="rounded-[10px] border-2 border-border bg-card p-5">
          <div className="flex items-center gap-2">
            <History className="h-5 w-5 text-[#1556a4]" aria-hidden="true" />
            <h2 className="text-xl font-black text-foreground">
              크레딧 적립 기준
            </h2>
          </div>
          <p className="mt-3 text-sm font-semibold leading-6 text-muted-foreground">
            회원 계정으로 결제 완료된 음반심의 건의 크레딧이 자동 적립됩니다.
          </p>
          <div className="mt-5 space-y-3">
            {creditSources.length > 0 ? (
              creditSources.map((submission) => (
                <div
                  key={submission.id}
                  className="rounded-[8px] border-2 border-border bg-background p-4"
                >
                  <p className="font-black text-foreground">
                    {submission.title ?? "앨범명 미입력"}
                  </p>
                  <p className="mt-1 text-xs font-semibold text-muted-foreground">
                    {submission.artist_name ?? "-"} · 발매일{" "}
                    {submission.release_date ?? "-"}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    적립일 {formatDate(submission.created_at)}
                  </p>
                </div>
              ))
            ) : (
              <p className="rounded-[8px] border-2 border-dashed border-border bg-background p-4 text-sm font-semibold text-muted-foreground">
                아직 크레딧으로 적립된 음반심의 결제 건이 없습니다.
              </p>
            )}
          </div>
        </section>
      </div>
    </DashboardShell>
  );
}
