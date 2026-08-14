import { redirect } from "next/navigation";
import Link from "next/link";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Coins,
  ExternalLink,
  History,
} from "lucide-react";

import {
  DashboardShell,
  defaultDashboardTabs,
  englishDefaultDashboardTabs,
} from "@/components/dashboard/dashboard-shell";
import {
  CreditActionNotice,
  type CreditActionNoticeState,
} from "@/features/credits/credit-action-notice";
import {
  getCreditRewardStudioUrl,
  getUserCreditSummary,
  stripCreditApprovalMessageDatePrefix,
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

export type MyPageCreditsSearchParams = {
  error?: string | string[];
  redeemed?: string | string[];
  studioRequested?: string | string[];
  creditsOpen?: string | string[];
  creditPage?: string | string[];
};

const magazineStatusLabels: Record<string, string> = {
  REQUESTED: "요청 접수",
  WRITING: "작성 중",
  PUBLISHED: "사용 완료",
  CANCELED: "취소됨",
};

const studioStatusLabels: Record<string, string> = {
  REQUESTED: "요청접수",
  APPROVED: "승인/안내 완료",
  USED: "사용완료",
  CANCELED: "취소됨",
};

const channelLabels: Record<string, string> = {
  DOMESTIC_NEWS: "국내뉴스",
  MEDIA: "미디어",
};

const creditSourcesPerPage = 10;

const firstParam = (value?: string | string[]) =>
  Array.isArray(value) ? value[0] : value;

const parsePositivePage = (value?: string | string[]) => {
  const parsed = Number(firstParam(value));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
};

const isOpenFlag = (value?: string | string[]) => firstParam(value) === "1";

const buildCreditsPath = ({
  creditPage,
  creditsOpen = true,
  localePrefix = "",
}: {
  creditPage?: number;
  creditsOpen?: boolean;
  localePrefix?: string;
}) => {
  const params = new URLSearchParams();
  if (creditsOpen) params.set("creditsOpen", "1");
  if (creditPage && creditPage > 1) {
    params.set("creditPage", String(creditPage));
  }
  const query = params.toString();
  return `${localePrefix}/mypage/credits${query ? `?${query}` : ""}#credit-sources`;
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

const getStudioRequestStatusLabel = (
  reservation: StudioReservationRequest,
  redemption?: CreditRewardRedemption,
) => {
  if (redemption?.status === "USED" || redemption?.used_at) {
    return studioStatusLabels.USED;
  }
  if (redemption?.status === "CANCELED" || reservation.status === "CANCELED") {
    return studioStatusLabels.CANCELED;
  }
  if (reservation.status === "APPROVED" || reservation.approved_at) {
    return studioStatusLabels.APPROVED;
  }
  return studioStatusLabels[reservation.status] ?? reservation.status;
};

const getStudioRequestStepIndex = (
  reservation: StudioReservationRequest,
  redemption?: CreditRewardRedemption,
) => {
  const label = getStudioRequestStatusLabel(reservation, redemption);
  if (label === studioStatusLabels.USED) return 2;
  if (label === studioStatusLabels.APPROVED) return 1;
  if (label === studioStatusLabels.REQUESTED) return 0;
  return -1;
};

const studioRequestSteps = [
  studioStatusLabels.REQUESTED,
  studioStatusLabels.APPROVED,
  studioStatusLabels.USED,
];

const noticeText = (
  error?: string | string[],
  redeemed?: string | string[],
  studioRequested?: string | string[],
  localePrefix = "",
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
      title: "서비스 이용 요청 접수",
      text: "서비스 이용 요청이 접수되었습니다. 관리자 승인 후 안내 문구가 표시됩니다.",
      actionHref: `${localePrefix}/mypage/credits#credit-requests`,
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
      actionHref: `${localePrefix}/mypage/credits#credit-requests`,
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
  redemption,
}: {
  reservation: StudioReservationRequest;
  redemption?: CreditRewardRedemption;
}) {
  const approvedMessage = stripCreditApprovalMessageDatePrefix(
    reservation.approved_message,
  );
  const studioUrl = getCreditRewardStudioUrl(reservation.reward_title);
  const statusLabel = getStudioRequestStatusLabel(reservation, redemption);
  const activeStepIndex = getStudioRequestStepIndex(reservation, redemption);
  const isUsed = statusLabel === studioStatusLabels.USED;

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
          {statusLabel}
        </span>
      </div>
      <p className="mt-2 text-xs font-semibold text-muted-foreground">
        희망일 {formatReservationDateTime(
          reservation.preferred_date,
          reservation.preferred_time,
        )}{" "}
        · {reservation.contact_phone}
      </p>
      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        {studioRequestSteps.map((step, index) => {
          const isDone = activeStepIndex >= index;
          const isActive = activeStepIndex === index;
          return (
            <div
              key={step}
              className={[
                "rounded-[8px] border-2 px-3 py-2 text-[11px] font-black",
                isDone
                  ? "border-[#111111] bg-[#1556a4] text-white dark:border-[#8bc3ff] dark:bg-[#8bc3ff] dark:text-[#06111f]"
                  : isActive
                    ? "border-[#111111] bg-[#f2cf27] text-[#111111]"
                    : "border-border bg-card text-muted-foreground",
              ].join(" ")}
            >
              {step}
            </div>
          );
        })}
      </div>
      {(reservation.status === "APPROVED" || isUsed) && approvedMessage ? (
        <div className="mt-3 rounded-[8px] border-2 border-[#111111] bg-[#f2cf27] px-3 py-2 text-xs font-black leading-5 text-[#111111]">
          {approvedMessage}
        </div>
      ) : null}
      {isUsed && redemption?.used_at ? (
        <p className="mt-3 text-xs font-semibold text-muted-foreground">
          사용완료 {formatDate(redemption.used_at)}
        </p>
      ) : null}
      {studioUrl ? (
        <a
          href={studioUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-[8px] border-2 border-[#111111] bg-background px-4 py-2 text-xs font-black text-foreground transition hover:-translate-y-0.5 hover:bg-[#f2cf27]"
        >
          녹음실 위치 보기
          <ExternalLink className="h-4 w-4" aria-hidden="true" />
        </a>
      ) : null}
    </div>
  );
}

function CreditSourceCard({
  submission,
}: {
  submission: CreditSourceSubmission;
}) {
  return (
    <div className="rounded-[8px] border-2 border-border bg-background p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-black text-foreground">
            {submission.title ?? "앨범명 미입력"}
          </p>
          <p className="mt-1 text-xs font-semibold text-muted-foreground">
            {submission.artist_name ?? "-"} · 발매일{" "}
            {submission.release_date ?? "-"}
          </p>
        </div>
        <span className="rounded-[6px] bg-[#f2cf27] px-2.5 py-1 text-[11px] font-black text-[#111111]">
          +1 크레딧
        </span>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        적립일 {formatDate(submission.created_at)}
      </p>
    </div>
  );
}

function CreditSourcePagination({
  currentPage,
  totalPages,
  totalCount,
  localePrefix = "",
}: {
  currentPage: number;
  totalPages: number;
  totalCount: number;
  localePrefix?: string;
}) {
  if (totalCount <= creditSourcesPerPage) return null;

  const from = (currentPage - 1) * creditSourcesPerPage + 1;
  const to = Math.min(currentPage * creditSourcesPerPage, totalCount);
  const pageStart = Math.max(1, currentPage - 2);
  const pageEnd = Math.min(totalPages, currentPage + 2);
  const pages = Array.from(
    { length: pageEnd - pageStart + 1 },
    (_, index) => pageStart + index,
  );
  const baseButtonClass =
    "inline-flex h-9 min-w-9 items-center justify-center rounded-[8px] border-2 px-3 text-xs font-black transition";
  const enabledClass =
    "border-[#111111] bg-background text-foreground hover:-translate-y-0.5 hover:bg-[#f2cf27]";
  const disabledClass =
    "cursor-not-allowed border-border bg-muted text-muted-foreground opacity-60";

  return (
    <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-4">
      <p className="text-xs font-semibold text-muted-foreground">
        {from.toLocaleString()}-{to.toLocaleString()} / 총{" "}
        {totalCount.toLocaleString()}건
      </p>
      <nav
        className="flex flex-wrap items-center gap-2"
        aria-label="크레딧 적립 내역 페이지"
      >
        {currentPage > 1 ? (
          <Link
            href={buildCreditsPath({
              creditPage: currentPage - 1,
              localePrefix,
            })}
            className={`${baseButtonClass} ${enabledClass}`}
            aria-label="이전 페이지"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </Link>
        ) : (
          <span className={`${baseButtonClass} ${disabledClass}`}>
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </span>
        )}

        {pages.map((page) => (
          <Link
            key={page}
            href={buildCreditsPath({ creditPage: page, localePrefix })}
            className={`${baseButtonClass} ${
              page === currentPage
                ? "border-[#111111] bg-[#1556a4] text-white"
                : enabledClass
            }`}
            aria-current={page === currentPage ? "page" : undefined}
          >
            {page}
          </Link>
        ))}

        {currentPage < totalPages ? (
          <Link
            href={buildCreditsPath({
              creditPage: currentPage + 1,
              localePrefix,
            })}
            className={`${baseButtonClass} ${enabledClass}`}
            aria-label="다음 페이지"
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        ) : (
          <span className={`${baseButtonClass} ${disabledClass}`}>
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </span>
        )}
      </nav>
    </div>
  );
}

export async function MyPageCreditsPageView({
  searchParams,
  localePrefix = "",
}: {
  searchParams?: Promise<MyPageCreditsSearchParams>;
  localePrefix?: string;
}) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(
      `${localePrefix}/login?next=${encodeURIComponent(`${localePrefix}/mypage/credits`)}`,
    );
  }

  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const creditSourcesOpen = isOpenFlag(resolvedSearchParams?.creditsOpen);
  const requestedCreditSourcePage = parsePositivePage(
    resolvedSearchParams?.creditPage,
  );
  const notice = noticeText(
    resolvedSearchParams?.error,
    resolvedSearchParams?.redeemed,
    resolvedSearchParams?.studioRequested,
    localePrefix,
  );
  const admin = createAdminClient();

  const [
    summary,
    creditSourcesCountResult,
    redemptionsResult,
    magazineRequestsResult,
    studioReservationsResult,
  ] =
    await Promise.all([
      getUserCreditSummary(admin, user.id),
      admin
        .from("submissions")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("type", "ALBUM")
        .eq("payment_status", "PAID"),
      admin
        .from("credit_reward_redemptions")
        .select(
          "id, user_id, reward_id, reward_title, reward_description, credits_spent, coupon_code, status, expires_at, admin_memo, issued_at, used_at, canceled_at, created_at",
        )
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(50),
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
  const creditSourcesTotal = creditSourcesCountResult.count ?? 0;
  const creditSourcesTotalPages = Math.max(
    1,
    Math.ceil(creditSourcesTotal / creditSourcesPerPage),
  );
  const creditSourcesCurrentPage = Math.min(
    requestedCreditSourcePage,
    creditSourcesTotalPages,
  );
  const creditSourcesRangeFrom =
    (creditSourcesCurrentPage - 1) * creditSourcesPerPage;
  const submissionsResult = await admin
    .from("submissions")
    .select("id, title, artist_name, release_date, created_at")
    .eq("user_id", user.id)
    .eq("type", "ALBUM")
    .eq("payment_status", "PAID")
    .order("created_at", { ascending: false })
    .range(
      creditSourcesRangeFrom,
      creditSourcesRangeFrom + creditSourcesPerPage - 1,
    );
  const creditSources =
    ((submissionsResult.data ?? []) as CreditSourceSubmission[]) ?? [];
  const magazineRequests =
    ((magazineRequestsResult.data ?? []) as UserMagazineRequest[]) ?? [];
  const studioReservations =
    ((studioReservationsResult.data ?? []) as StudioReservationRequest[]) ?? [];
  const redemptionMap = new Map(
    redemptions.map((redemption) => [redemption.id, redemption]),
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
        description="음반심의 결제 완료 건으로 적립된 크레딧을 매거진 발행이나 서비스 이용 요청에 사용할 수 있습니다."
        activeTab="credits"
        tabs={
          localePrefix === "/en"
            ? englishDefaultDashboardTabs
            : defaultDashboardTabs
        }
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
                적립 크레딧은 매거진 발행, 녹음실 이용권 등으로 사용 가능합니다.
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
              label="서비스 사용"
              value={summary.rewardUsed}
              description="서비스 이용 요청에 사용"
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
                    redemption={redemptionMap.get(item.reservation.redemption_id)}
                  />
                ),
              )}
            </div>
          ) : (
            <p className="mt-5 rounded-[10px] border-2 border-dashed border-border bg-background p-5 text-sm font-semibold text-muted-foreground">
              아직 크레딧으로 접수한 매거진 발행 또는 서비스 이용 요청이 없습니다.
            </p>
          )}
        </section>

        <section
          id="credit-sources"
          className="scroll-mt-28 rounded-[10px] border-2 border-border bg-card"
        >
          <details open={creditSourcesOpen} className="group">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-5 marker:hidden">
              <span className="flex min-w-0 items-center gap-2">
                <History
                  className="h-5 w-5 shrink-0 text-[#1556a4]"
                  aria-hidden="true"
                />
                <span>
                  <span className="block text-xl font-black text-foreground">
                    크레딧 적립 내역
                  </span>
                  <span className="mt-1 block text-sm font-semibold leading-6 text-muted-foreground">
                    결제 완료된 음반심의 건마다 1크레딧이 자동 적립됩니다.
                  </span>
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="rounded-[8px] border-2 border-[#111111] bg-background px-3 py-1 text-xs font-black text-foreground">
                  {creditSourcesTotal.toLocaleString()}건
                </span>
                <ChevronDown
                  className="h-5 w-5 text-muted-foreground transition group-open:rotate-180"
                  aria-hidden="true"
                />
              </span>
            </summary>

            <div className="border-t border-border/60 p-5 pt-4">
              {creditSourcesTotal > 0 ? (
                <>
                  <div className="space-y-3">
                    {creditSources.map((submission) => (
                      <CreditSourceCard
                        key={submission.id}
                        submission={submission}
                      />
                    ))}
                  </div>
                  <CreditSourcePagination
                    currentPage={creditSourcesCurrentPage}
                    totalPages={creditSourcesTotalPages}
                    totalCount={creditSourcesTotal}
                    localePrefix={localePrefix}
                  />
                </>
              ) : (
                <p className="rounded-[8px] border-2 border-dashed border-border bg-background p-4 text-sm font-semibold text-muted-foreground">
                  아직 크레딧으로 적립된 음반심의 결제 건이 없습니다.
                </p>
              )}
            </div>
          </details>
        </section>
      </div>
    </DashboardShell>
  );
}

export default async function MyPageCreditsPage({
  searchParams,
}: {
  searchParams?: Promise<MyPageCreditsSearchParams>;
}) {
  return MyPageCreditsPageView({ searchParams });
}
