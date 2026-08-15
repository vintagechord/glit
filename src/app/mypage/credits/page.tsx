import { redirect } from "next/navigation";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Coins,
  ExternalLink,
  Gift,
  History,
  Newspaper,
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
  REQUESTED: "접수",
  WRITING: "진행",
  PUBLISHED: "완료",
  CANCELED: "취소",
};

const studioStatusLabels: Record<string, string> = {
  REQUESTED: "접수",
  APPROVED: "승인",
  USED: "사용",
  CANCELED: "취소",
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
    return "완료";
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
      title: "요청 완료",
      text: "승인 결과는 이 화면에서 확인할 수 있습니다.",
      actionHref: `${localePrefix}/mypage/credits#credit-requests`,
      actionLabel: "내역 보기",
      clearQueryParams: ["redeemed"],
    };
  }
  const studioRequestedFlag = Array.isArray(studioRequested)
    ? studioRequested[0]
    : studioRequested;
  if (studioRequestedFlag) {
    return {
      type: "success" as const,
      title: "예약 요청 완료",
      text: "승인 결과는 이 화면과 입력한 연락처로 안내됩니다.",
      actionHref: `${localePrefix}/mypage/credits#credit-requests`,
      actionLabel: "내역 보기",
      clearQueryParams: ["studioRequested"],
    };
  }
  return null;
};

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <div className={`rounded-[10px] border-2 p-3 sm:p-4 ${tone}`}>
      <p className="text-[11px] font-black uppercase tracking-normal opacity-70">
        {label}
      </p>
      <p className="mt-1 text-xl font-black sm:text-2xl">{value.toLocaleString()}</p>
    </div>
  );
}

function MagazineRequestCard({ request }: { request: UserMagazineRequest }) {
  return (
    <div className="rounded-[10px] border-2 border-border bg-background p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-black text-foreground">
            {request.album_title ?? "제목 미입력"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="rounded-[6px] border border-border px-2 py-1 text-[10px] font-black text-muted-foreground">
            매거진
          </span>
          <span className="rounded-[6px] bg-[#f2cf27] px-2.5 py-1 text-[11px] font-black text-[#111111]">
            {getMagazineRequestStatusLabel(request)}
          </span>
        </div>
      </div>
      <p className="mt-2 text-xs font-semibold text-muted-foreground">
        {request.artist_name ?? "-"} ·{" "}
        {channelLabels[request.target_channel ?? ""] ??
          request.target_channel ??
          "-"}{" "}
        · {formatDate(request.created_at)}
      </p>
      {request.published_url ? (
        <a
          href={request.published_url}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-[8px] border-2 border-[#111111] bg-[#f2cf27] px-3 py-2 text-xs font-black text-[#111111] transition hover:-translate-y-0.5"
        >
          발행 보기
          <ExternalLink className="h-4 w-4" aria-hidden="true" />
        </a>
      ) : null}
      {request.admin_memo ? (
        <details className="mt-3 rounded-[8px] border border-border bg-card px-3 py-2 text-xs">
          <summary className="cursor-pointer font-black text-foreground">관리자 메모</summary>
          <p className="mt-2 whitespace-pre-wrap font-semibold leading-5 text-muted-foreground">
            {request.admin_memo}
          </p>
        </details>
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
        <div className="min-w-0">
          <p className="truncate font-black text-foreground">
            {reservation.reward_title}
          </p>
        </div>
        {statusLabel === studioStatusLabels.CANCELED ? (
          <span className="rounded-[6px] bg-[#d9362c] px-2.5 py-1 text-[11px] font-black text-white">
            {statusLabel}
          </span>
        ) : null}
      </div>
      <p className="mt-2 truncate text-xs font-semibold text-muted-foreground">
        {formatReservationDateTime(
          reservation.preferred_date,
          reservation.preferred_time,
        )}{" "}
        · {reservation.contact_phone}
      </p>
      <div className="mt-4 grid grid-cols-3 gap-2">
        {studioRequestSteps.map((step, index) => {
          const isDone = activeStepIndex >= index;
          const isActive = activeStepIndex === index;
          return (
            <div
              key={step}
              className={[
                "min-w-0 rounded-[8px] border-2 px-1.5 py-2 text-center text-[11px] font-black",
                isDone
                  ? "border-[#111111] bg-[#1556a4] text-white dark:border-[#8bc3ff] dark:bg-[#8bc3ff] dark:text-[#06111f]"
                  : isActive
                    ? "border-[#111111] bg-[#f2cf27] text-[#111111]"
                    : "border-border bg-card text-muted-foreground",
              ].join(" ")}
            >
              {isDone ? <Check className="mr-1 inline h-3 w-3" aria-hidden="true" /> : null}
              {step}
            </div>
          );
        })}
      </div>
      {(reservation.status === "APPROVED" || isUsed) && approvedMessage ? (
        <details className="mt-3 rounded-[8px] border-2 border-[#111111] bg-[#f2cf27] px-3 py-2 text-xs text-[#111111]">
          <summary className="cursor-pointer font-black">이용 안내</summary>
          <p className="mt-2 whitespace-pre-wrap font-semibold leading-5">{approvedMessage}</p>
        </details>
      ) : null}
      {isUsed && redemption?.used_at ? (
        <p className="mt-3 text-xs font-semibold text-muted-foreground">
          {formatDate(redemption.used_at)}
        </p>
      ) : null}
      {studioUrl ? (
        <a
          href={studioUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-[8px] border-2 border-[#111111] bg-background px-4 py-2 text-xs font-black text-foreground transition hover:-translate-y-0.5 hover:bg-[#f2cf27]"
        >
          위치
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
            {submission.artist_name ?? "-"} · {submission.release_date ?? "-"}
          </p>
        </div>
        <span className="rounded-[6px] bg-[#f2cf27] px-2.5 py-1 text-[11px] font-black text-[#111111]">
          +1
        </span>
      </div>
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
  const [latestCreditRequest, ...olderCreditRequests] = creditRequestItems;

  const renderCreditRequest = (item: (typeof creditRequestItems)[number]) =>
    item.type === "magazine" ? (
      <MagazineRequestCard key={item.key} request={item.request} />
    ) : (
      <StudioReservationCard
        key={item.key}
        reservation={item.reservation}
        redemption={redemptionMap.get(item.reservation.redemption_id)}
      />
    );

  return (
      <DashboardShell
        title="나의 크레딧"
        activeTab="credits"
        tabs={
          localePrefix === "/en"
            ? englishDefaultDashboardTabs
            : defaultDashboardTabs
        }
        contextLabel={localePrefix === "/en" ? "My Page" : "마이페이지"}
    >
      <div className="space-y-6">
        <CreditActionNotice notice={notice} />

        <section
          aria-label="크레딧 현황"
          className="grid items-start gap-5 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]"
        >
          <section className="rounded-[10px] border-2 border-[#111111] bg-[#fffaf0] p-4 shadow-[5px_5px_0_#111111] dark:border-[#f2cf27] dark:bg-[#171717] dark:shadow-[5px_5px_0_#f2cf27] sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-black text-muted-foreground">보유 크레딧</p>
                <p className="mt-1 flex items-center gap-2 text-4xl font-black text-foreground">
                  <Coins className="h-7 w-7 text-[#1556a4]" aria-hidden="true" />
                  {summary.available.toLocaleString()}
                </p>
              </div>
              <span className="inline-flex items-center gap-2 rounded-[8px] border-2 border-[#111111] bg-[#f2cf27] px-3 py-2 text-xs font-black text-[#111111]">
                <Coins className="h-4 w-4" aria-hidden="true" />
                음반 1건 = +1
              </span>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2">
              <SummaryCard
                label="총 적립"
                value={summary.earned}
                tone="border-[#111111] bg-white text-[#111111]"
              />
              <SummaryCard
                label="매거진 사용"
                value={summary.magazineUsed}
                tone="border-border bg-card text-foreground"
              />
              <SummaryCard
                label="서비스 사용"
                value={summary.rewardUsed}
                tone="border-border bg-card text-foreground"
              />
            </div>
          </section>

          <section
            id="credit-requests"
            className="scroll-mt-28 rounded-[10px] border-2 border-border bg-card p-4 sm:p-5"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-xl font-black text-foreground">요청 내역</h2>
              <span className="rounded-[8px] border-2 border-[#111111] bg-background px-3 py-1 text-xs font-black text-foreground">
                {creditRequestItems.length.toLocaleString()}건
              </span>
            </div>

            {hasCreditRequests && latestCreditRequest ? (
              <div className="mt-4 space-y-3">
                {renderCreditRequest(latestCreditRequest)}
                {olderCreditRequests.length > 0 ? (
                  <details className="group rounded-[8px] border-2 border-border bg-background">
                    <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-2 text-sm font-black text-foreground marker:hidden">
                      전체 요청 보기
                      <span className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          +{olderCreditRequests.length.toLocaleString()}
                        </span>
                        <ChevronDown
                          className="h-4 w-4 transition group-open:rotate-180"
                          aria-hidden="true"
                        />
                      </span>
                    </summary>
                    <div className="grid gap-3 border-t border-border p-3">
                      {olderCreditRequests.map(renderCreditRequest)}
                    </div>
                  </details>
                ) : null}
              </div>
            ) : (
              <p className="mt-4 rounded-[8px] border-2 border-dashed border-border bg-background p-4 text-sm font-semibold text-muted-foreground">
                요청 내역이 없습니다.
              </p>
            )}
          </section>
        </section>

        <section
          aria-label="크레딧 사용"
          className="w-full rounded-[10px] border-2 border-border bg-card p-4 sm:p-5"
        >
          <div className="mb-4 flex items-center gap-2">
            <Coins className="h-5 w-5 text-[#1556a4]" aria-hidden="true" />
            <h2 className="text-xl font-black text-foreground">크레딧 사용하기</h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Link
              href={`${localePrefix}/magazine?tab=magazine#credit-use`}
              aria-label="매거진 발행 요청하기"
              className="group flex min-h-[176px] flex-col justify-between rounded-[10px] border-2 border-[#111111] bg-[#f2cf27] p-5 text-[#111111] shadow-[5px_5px_0_#1556a4] transition hover:-translate-y-1 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#1556a4]/35"
            >
              <span className="flex items-start justify-between gap-4">
                <span className="inline-flex h-12 w-12 items-center justify-center rounded-[8px] border-2 border-[#111111] bg-white">
                  <Newspaper className="h-6 w-6" aria-hidden="true" />
                </span>
                <span className="rounded-[6px] border border-[#111111]/25 px-2 py-1 text-[11px] font-black">
                  1크레딧
                </span>
              </span>
              <span className="mt-6">
                <span className="block text-xl font-black">매거진 발행 요청</span>
                <span className="mt-1 block text-sm font-semibold text-[#111111]/70">
                  아티스트·앨범 콘텐츠 발행
                </span>
                <span className="mt-4 inline-flex items-center gap-2 text-sm font-black">
                  발행 요청하기
                  <ArrowRight
                    className="h-4 w-4 transition group-hover:translate-x-1"
                    aria-hidden="true"
                  />
                </span>
              </span>
            </Link>

            <Link
              href={`${localePrefix}/magazine?tab=services#credit-use`}
              aria-label="서비스 이용 요청하기"
              className="group flex min-h-[176px] flex-col justify-between rounded-[10px] border-2 border-[#111111] bg-[#1556a4] p-5 text-white shadow-[5px_5px_0_#f2cf27] transition hover:-translate-y-1 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#f2cf27]/40"
            >
              <span className="flex items-start justify-between gap-4">
                <span className="inline-flex h-12 w-12 items-center justify-center rounded-[8px] border-2 border-white bg-white text-[#1556a4]">
                  <Gift className="h-6 w-6" aria-hidden="true" />
                </span>
                <span className="rounded-[6px] border border-white/35 px-2 py-1 text-[11px] font-black text-white/90">
                  서비스별 차감
                </span>
              </span>
              <span className="mt-6">
                <span className="block text-xl font-black">서비스 이용 요청</span>
                <span className="mt-1 block text-sm font-semibold text-white/75">
                  녹음실 등 연계 서비스 신청
                </span>
                <span className="mt-4 inline-flex items-center gap-2 text-sm font-black">
                  신청하기
                  <ArrowRight
                    className="h-4 w-4 transition group-hover:translate-x-1"
                    aria-hidden="true"
                  />
                </span>
              </span>
            </Link>
          </div>
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
                    적립 내역
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
                  적립 내역이 없습니다.
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
