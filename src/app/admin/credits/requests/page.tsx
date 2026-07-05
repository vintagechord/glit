import Link from "next/link";
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Newspaper,
  Ticket,
} from "lucide-react";

import { AdminSaveToast } from "@/components/admin/save-toast";
import { updateStudioReservationStatusFormAction } from "@/features/credits/actions";
import { updateMagazineRequestStatusFormAction } from "@/features/magazine/actions";
import { formatDate, formatDateTime } from "@/lib/format";
import {
  stripCreditApprovalMessageDatePrefix,
  type CreditRewardRedemption,
  type StudioReservationRequest,
} from "@/lib/credits";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "크레딧 요청 관리",
};

type SearchParamsInput = {
  saved?: string | string[];
  error?: string | string[];
  view?: string | string[];
  page?: string | string[];
};

type RequestView = "magazine" | "services";

type ProfileRow = {
  user_id: string;
  name: string | null;
  company: string | null;
  phone: string | null;
};

type MagazineRequestRow = {
  id: string;
  submission_id: string | null;
  user_id: string | null;
  target_channel: string | null;
  status: string | null;
  requester_name: string | null;
  requester_email: string | null;
  requester_phone: string | null;
  album_title: string | null;
  artist_name: string | null;
  release_date: string | null;
  published_url: string | null;
  admin_memo: string | null;
  created_at: string | null;
};

const magazineStatusOptions = [
  "REQUESTED",
  "WRITING",
  "PUBLISHED",
  "CANCELED",
] as const;

const magazineStatusLabels: Record<string, string> = {
  REQUESTED: "요청 접수",
  WRITING: "작성 중",
  PUBLISHED: "발행 완료",
  CANCELED: "취소",
};

const studioStatusOptions = [
  "REQUESTED",
  "APPROVED",
  "USED",
  "CANCELED",
] as const;

const studioStatusLabels: Record<string, string> = {
  REQUESTED: "요청접수",
  APPROVED: "승인/안내 완료",
  USED: "사용완료",
  CANCELED: "취소",
};

const redemptionStatusLabels: Record<string, string> = {
  ISSUED: "요청접수",
  USED: "사용완료",
  CANCELED: "취소",
};

const channelLabels: Record<string, string> = {
  DOMESTIC_NEWS: "국내뉴스",
  MEDIA: "미디어",
};

const fieldClass =
  "min-h-10 rounded-2xl border border-border/70 bg-card px-4 py-2 text-xs text-foreground";

const labelClass = "grid gap-1 text-xs font-semibold text-muted-foreground";
const requestsPerPage = 20;

const toSingle = (value?: string | string[]) =>
  Array.isArray(value) ? value[0] : value;

const parseRequestView = (value?: string | string[]): RequestView =>
  toSingle(value) === "services" ? "services" : "magazine";

const parsePage = (value?: string | string[]) => {
  const parsed = Number(toSingle(value));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
};

const buildRequestPath = (view: RequestView, page = 1) =>
  `/admin/credits/requests?view=${view}&page=${page}`;

function RequestViewBanner({
  view,
  activeView,
  title,
  description,
  count,
}: {
  view: RequestView;
  activeView: RequestView;
  title: string;
  description: string;
  count: number;
}) {
  const isActive = view === activeView;
  const Icon = view === "magazine" ? Newspaper : Ticket;

  return (
    <Link
      href={buildRequestPath(view)}
      className={`group flex min-h-[126px] items-stretch rounded-[10px] border-2 p-4 transition hover:-translate-y-0.5 ${
        isActive
          ? "border-[#111111] bg-[#1556a4] text-white shadow-[5px_5px_0_#f2cf27]"
          : "border-border bg-card text-foreground hover:border-[#1556a4]"
      }`}
      aria-current={isActive ? "page" : undefined}
    >
      <span
        className={`mr-4 inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-[8px] border-2 ${
          isActive
            ? "border-white bg-white text-[#1556a4]"
            : "border-border bg-background text-[#1556a4]"
        }`}
      >
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-lg font-black">{title}</span>
        <span
          className={`mt-2 text-xs font-semibold leading-5 ${
            isActive ? "text-white/78" : "text-muted-foreground"
          }`}
        >
          {description}
        </span>
        <span
          className={`mt-auto w-fit rounded-[6px] border px-2.5 py-1 text-[11px] font-black ${
            isActive
              ? "border-white/35 text-white"
              : "border-border text-muted-foreground"
          }`}
        >
          총 {count.toLocaleString()}건
        </span>
      </span>
    </Link>
  );
}

function PaginationControls({
  activeView,
  currentPage,
  totalPages,
  totalCount,
}: {
  activeView: RequestView;
  currentPage: number;
  totalPages: number;
  totalCount: number;
}) {
  if (totalCount <= requestsPerPage) return null;

  const from = (currentPage - 1) * requestsPerPage + 1;
  const to = Math.min(currentPage * requestsPerPage, totalCount);
  const prevPage = Math.max(1, currentPage - 1);
  const nextPage = Math.min(totalPages, currentPage + 1);
  const pageStart = Math.max(1, currentPage - 2);
  const pageEnd = Math.min(totalPages, currentPage + 2);
  const pages = Array.from(
    { length: pageEnd - pageStart + 1 },
    (_, index) => pageStart + index,
  );
  const baseButtonClass =
    "inline-flex h-9 min-w-9 items-center justify-center rounded-[8px] border-2 px-3 text-xs font-black transition";
  const disabledClass =
    "cursor-not-allowed border-border bg-muted text-muted-foreground opacity-60";
  const enabledClass =
    "border-[#111111] bg-background text-foreground hover:-translate-y-0.5 hover:bg-[#f2cf27]";

  return (
    <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-4">
      <p className="text-xs font-semibold text-muted-foreground">
        {from.toLocaleString()}-{to.toLocaleString()} / 총{" "}
        {totalCount.toLocaleString()}건
      </p>
      <nav
        className="flex flex-wrap items-center gap-2"
        aria-label="크레딧 요청 페이지"
      >
        {currentPage > 1 ? (
          <Link
            href={buildRequestPath(activeView, prevPage)}
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
            href={buildRequestPath(activeView, page)}
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
            href={buildRequestPath(activeView, nextPage)}
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

const formatReservationDateTime = (date?: string | null, time?: string | null) =>
  `${formatDate(date)}${time ? ` ${time.slice(0, 5)}` : ""}`;

const buildDefaultUseMessage = (
  reservation: Pick<
    StudioReservationRequest,
    "reward_title" | "service_location"
  >,
) =>
  `${reservation.service_location ?? reservation.reward_title} 이용 안내를 적어주신 연락처로 드립니다.`;

export default async function AdminCreditRequestsPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParamsInput>;
}) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const savedFlag = toSingle(resolvedSearchParams?.saved);
  const errorFlag = toSingle(resolvedSearchParams?.error);
  const activeView = parseRequestView(resolvedSearchParams?.view);
  const requestedPage = parsePage(resolvedSearchParams?.page);
  const admin = createAdminClient();

  const [magazineCountResult, studioCountResult] = await Promise.all([
    admin
      .from("magazine_requests")
      .select("id", { count: "exact", head: true }),
    admin
      .from("studio_reservation_requests")
      .select("id", { count: "exact", head: true }),
  ]);
  const magazineTotal = magazineCountResult.count ?? 0;
  const studioTotal = studioCountResult.count ?? 0;
  const activeTotal = activeView === "magazine" ? magazineTotal : studioTotal;
  const totalPages = Math.max(1, Math.ceil(activeTotal / requestsPerPage));
  const currentPage = Math.min(requestedPage, totalPages);
  const rangeFrom = (currentPage - 1) * requestsPerPage;
  const rangeTo = rangeFrom + requestsPerPage - 1;
  const currentListPath = buildRequestPath(activeView, currentPage);

  const magazineResult =
    activeView === "magazine"
      ? await admin
          .from("magazine_requests")
          .select(
            "id, submission_id, user_id, target_channel, status, requester_name, requester_email, requester_phone, album_title, artist_name, release_date, published_url, admin_memo, created_at",
          )
          .order("created_at", { ascending: false })
          .range(rangeFrom, rangeTo)
      : { data: [] as MagazineRequestRow[], error: null };
  const studioResult =
    activeView === "services"
      ? await admin
          .from("studio_reservation_requests")
          .select(
            "id, user_id, redemption_id, reward_id, reward_title, service_location, status, preferred_date, preferred_time, duration_hours, contact_name, contact_phone, contact_email, notes, approved_message, admin_memo, approved_at, canceled_at, created_at",
          )
          .order("created_at", { ascending: false })
          .range(rangeFrom, rangeTo)
      : { data: [] as StudioReservationRequest[], error: null };

  const magazineRequests =
    ((magazineResult.data ?? []) as MagazineRequestRow[]) ?? [];
  const studioRequests =
    ((studioResult.data ?? []) as StudioReservationRequest[]) ?? [];
  const studioRedemptionIds = studioRequests.map(
    (request) => request.redemption_id,
  );
  const { data: studioRedemptionsData } =
    studioRedemptionIds.length > 0
      ? await admin
          .from("credit_reward_redemptions")
          .select(
            "id, user_id, reward_id, reward_title, reward_description, credits_spent, coupon_code, status, expires_at, admin_memo, issued_at, used_at, canceled_at, created_at",
          )
          .in("id", studioRedemptionIds)
      : { data: [] as CreditRewardRedemption[] };
  const studioRedemptionMap = new Map(
    ((studioRedemptionsData ?? []) as CreditRewardRedemption[]).map(
      (redemption) => [redemption.id, redemption],
    ),
  );
  const userIds = Array.from(
    new Set(
      [...magazineRequests, ...studioRequests]
        .map((request) => request.user_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const { data: profilesData } =
    userIds.length > 0
      ? await admin
          .from("profiles")
          .select("user_id, name, company, phone")
          .in("user_id", userIds)
      : { data: [] as ProfileRow[] };
  const profileMap = new Map(
    ((profilesData ?? []) as ProfileRow[]).map((profile) => [
      profile.user_id,
      profile,
    ]),
  );

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-12">
      {savedFlag ? <AdminSaveToast message="저장되었습니다." /> : null}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
            Admin
          </p>
          <h1 className="font-display mt-2 text-3xl text-foreground">
            크레딧 요청 관리
          </h1>
          <p className="mt-3 max-w-3xl text-sm text-muted-foreground">
            크레딧으로 접수된 매거진 발행 요청과 서비스 이용 요청을 처리합니다.
          </p>
        </div>
        <Link
          href="/admin/credits"
          className="rounded-full border border-border bg-background px-4 py-2 text-xs font-semibold text-foreground transition hover:border-foreground"
        >
          크레딧 서비스 관리
        </Link>
      </div>

      {errorFlag ? (
        <div className="mt-6 rounded-2xl border border-dashed border-red-500/40 bg-red-500/10 px-4 py-3 text-xs text-red-600">
          요청 상태 저장 중 오류가 발생했습니다. 입력값과 마이그레이션 적용 상태를
          확인해주세요.
        </div>
      ) : null}

      {magazineCountResult.error || studioCountResult.error ? (
        <div className="mt-6 rounded-2xl border border-dashed border-red-500/40 bg-red-500/10 px-4 py-3 text-xs text-red-600">
          요청 건수 집계 중 오류가 발생했습니다.
        </div>
      ) : null}

      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <RequestViewBanner
          view="magazine"
          activeView={activeView}
          title="매거진 발행 요청"
          description="발행 URL, 발행 상태, 관리자 메모를 처리합니다."
          count={magazineTotal}
        />
        <RequestViewBanner
          view="services"
          activeView={activeView}
          title="서비스 이용 요청"
          description="연락처, 이메일, 희망 일정, 요청사항을 확인합니다."
          count={studioTotal}
        />
      </div>

      {activeView === "magazine" ? (
      <section className="mt-8 space-y-4 rounded-[32px] border border-border/60 bg-card/80 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              매거진 발행 요청
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              발행 URL을 저장하고 상태를 발행 완료로 바꾸면 사용자 화면에서 바로
              발행 링크가 표시됩니다.
            </p>
          </div>
          <span className="rounded-full border border-border bg-background px-3 py-1 text-xs font-semibold text-muted-foreground">
            최신순 · {magazineTotal.toLocaleString()}건
          </span>
        </div>

        {magazineResult.error ? (
          <div className="rounded-2xl border border-dashed border-red-500/40 bg-red-500/10 px-4 py-3 text-xs text-red-600">
            매거진 요청을 불러오지 못했습니다. ({magazineResult.error.message})
          </div>
        ) : magazineRequests.length > 0 ? (
          <div className="space-y-4">
            {magazineRequests.map((request) => {
              const profile = request.user_id
                ? profileMap.get(request.user_id)
                : null;

              return (
                <article
                  key={request.id}
                  className="rounded-2xl border border-border/60 bg-background/70 p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="flex flex-wrap gap-2">
                        <span className="rounded-[6px] bg-[#f2cf27] px-2 py-1 text-[10px] font-black text-[#111111]">
                          {magazineStatusLabels[request.status ?? ""] ??
                            request.status}
                        </span>
                        <span className="rounded-[6px] border border-border px-2 py-1 text-[10px] font-black text-muted-foreground">
                          {channelLabels[request.target_channel ?? ""] ??
                            request.target_channel ??
                            "-"}
                        </span>
                      </div>
                      <h3 className="mt-3 text-base font-black text-foreground">
                        {request.artist_name ?? "-"} ·{" "}
                        {request.album_title ?? "제목 미입력"}
                      </h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        요청일 {formatDateTime(request.created_at)} · 발매일{" "}
                        {formatDate(request.release_date)}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {profile?.name ?? request.requester_name ?? "회원명 미입력"}
                        {profile?.company ? ` · ${profile.company}` : ""} ·{" "}
                        {request.requester_phone ?? profile?.phone ?? "-"} ·{" "}
                        {request.requester_email ?? "-"}
                      </p>
                    </div>
                    {request.published_url ? (
                      <a
                        href={request.published_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 rounded-[8px] border-2 border-[#111111] bg-[#f2cf27] px-3 py-2 text-xs font-black text-[#111111]"
                      >
                        발행 URL
                        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                      </a>
                    ) : null}
                  </div>

                  <form
                    action={updateMagazineRequestStatusFormAction}
                    className="mt-4 grid gap-3 md:grid-cols-[150px_1fr_1fr_auto]"
                  >
                    <input type="hidden" name="requestId" value={request.id} />
                    <input
                      type="hidden"
                      name="redirectTo"
                      value={currentListPath}
                    />
                    <label className={labelClass}>
                      상태
                      <select
                        name="status"
                        defaultValue={request.status ?? "REQUESTED"}
                        className={fieldClass}
                      >
                        {magazineStatusOptions.map((status) => (
                          <option key={status} value={status}>
                            {magazineStatusLabels[status]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className={labelClass}>
                      발행 URL
                      <input
                        name="publishedUrl"
                        defaultValue={request.published_url ?? ""}
                        placeholder="https://..."
                        className={fieldClass}
                      />
                    </label>
                    <label className={labelClass}>
                      관리자 메모
                      <input
                        name="adminMemo"
                        defaultValue={request.admin_memo ?? ""}
                        className={fieldClass}
                      />
                    </label>
                    <div className="flex items-end">
                      <button
                        type="submit"
                        className="h-10 rounded-full bg-foreground px-5 text-xs font-semibold uppercase tracking-[0.2em] text-background"
                      >
                        저장
                      </button>
                    </div>
                  </form>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-border/60 bg-background/70 px-4 py-6 text-xs text-muted-foreground">
            접수된 매거진 발행 요청이 없습니다.
          </div>
        )}
        <PaginationControls
          activeView={activeView}
          currentPage={currentPage}
          totalPages={totalPages}
          totalCount={activeTotal}
        />
      </section>
      ) : null}

      {activeView === "services" ? (
      <section className="mt-6 space-y-4 rounded-[32px] border border-border/60 bg-card/80 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              서비스 이용 요청
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              요청접수, 승인/안내 완료, 사용완료까지 이 화면에서 처리합니다.
            </p>
          </div>
          <span className="rounded-full border border-border bg-background px-3 py-1 text-xs font-semibold text-muted-foreground">
            최신순 · {studioTotal.toLocaleString()}건
          </span>
        </div>

        {studioResult.error ? (
          <div className="rounded-2xl border border-dashed border-red-500/40 bg-red-500/10 px-4 py-3 text-xs text-red-600">
            서비스 이용 요청을 불러오지 못했습니다. ({studioResult.error.message})
          </div>
        ) : studioRequests.length > 0 ? (
          <div className="space-y-4">
            {studioRequests.map((request) => {
              const profile = profileMap.get(request.user_id);
              const defaultMessage =
                stripCreditApprovalMessageDatePrefix(request.approved_message) ||
                buildDefaultUseMessage(request);
              const redemption = studioRedemptionMap.get(request.redemption_id);
              const effectiveStatus =
                redemption?.status === "USED" ? "USED" : request.status;

              return (
                <article
                  key={request.id}
                  className="rounded-2xl border border-border/60 bg-background/70 p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="flex flex-wrap gap-2">
                        <span className="rounded-[6px] bg-[#f2cf27] px-2 py-1 text-[10px] font-black text-[#111111]">
                          {studioStatusLabels[effectiveStatus] ?? effectiveStatus}
                        </span>
                        <span className="rounded-[6px] border border-border px-2 py-1 text-[10px] font-black text-muted-foreground">
                          {request.service_location ?? "서비스 위치 미입력"}
                        </span>
                      </div>
                      <h3 className="mt-3 text-base font-black text-foreground">
                        {request.reward_title}
                      </h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        희망일{" "}
                        {formatReservationDateTime(
                          request.preferred_date,
                          request.preferred_time,
                        )}{" "}
                        · {request.duration_hours}시간
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {profile?.name ?? request.contact_name}
                        {profile?.company ? ` · ${profile.company}` : ""} ·{" "}
                        {request.contact_phone} · {request.contact_email ?? "-"}
                      </p>
                    {request.notes ? (
                        <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-muted-foreground">
                          요청사항: {request.notes}
                        </p>
                      ) : null}
                    </div>
                    {redemption ? (
                      <div className="min-w-[150px] rounded-[10px] border-2 border-[#111111] bg-[#111111] px-3 py-2 text-white">
                        <p className="text-[10px] font-black uppercase tracking-normal text-white/60">
                          Credit Use
                        </p>
                        <p className="mt-1 text-[11px] font-semibold text-white/70">
                          {redemption.credits_spent.toLocaleString()}크레딧 ·{" "}
                          {redemptionStatusLabels[redemption.status] ??
                            redemption.status}
                        </p>
                      </div>
                    ) : null}
                  </div>

                  <form
                    action={updateStudioReservationStatusFormAction}
                    className="mt-4 grid gap-3 md:grid-cols-[150px_1fr_auto]"
                  >
                    <input
                      type="hidden"
                      name="reservationId"
                      value={request.id}
                    />
                    <input
                      type="hidden"
                      name="redirectTo"
                      value={currentListPath}
                    />
                    <label className={labelClass}>
                      상태
                      <select
                        name="status"
                        defaultValue={effectiveStatus}
                        className={fieldClass}
                      >
                        {studioStatusOptions.map((status) => (
                          <option key={status} value={status}>
                            {studioStatusLabels[status]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className={labelClass}>
                      승인 안내 문구
                      <textarea
                        name="approvedMessage"
                        rows={3}
                        defaultValue={defaultMessage}
                        className={fieldClass}
                      />
                    </label>
                    <div className="flex items-end">
                      <button
                        type="submit"
                        className="h-10 rounded-full bg-foreground px-5 text-xs font-semibold uppercase tracking-[0.2em] text-background"
                      >
                        저장
                      </button>
                    </div>
                    <label className={`${labelClass} md:col-span-3`}>
                      관리자 메모
                      <input
                        name="adminMemo"
                        defaultValue={request.admin_memo ?? ""}
                        className={fieldClass}
                      />
                    </label>
                  </form>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-border/60 bg-background/70 px-4 py-6 text-xs text-muted-foreground">
            접수된 서비스 이용 요청이 없습니다.
          </div>
        )}
        <PaginationControls
          activeView={activeView}
          currentPage={currentPage}
          totalPages={totalPages}
          totalCount={activeTotal}
        />
      </section>
      ) : null}
    </div>
  );
}
