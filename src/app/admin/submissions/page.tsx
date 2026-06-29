import Link from "next/link";
import type { ReactNode } from "react";
import {
  Archive,
  ChevronLeft,
  ChevronRight,
  FileText,
  Filter,
  Search,
  Settings,
} from "lucide-react";

import {
  paymentStatusLabelMap,
  paymentStatusOptions,
  reviewStatusLabelMap,
  reviewStatusOptions,
  type PaymentStatus,
  type ReviewStatus,
} from "@/constants/review-status";
import { formatDateTime } from "@/lib/format";
import { createServerSupabase } from "@/lib/supabase/server";
import { AdminDeleteButton } from "@/components/admin/delete-button";
import {
  ReviewDocsBulkToolbar,
  ReviewDocsRowCheckbox,
  ReviewDocsSelectionProvider,
} from "@/components/admin/review-docs-download";

export const metadata = {
  title: "접수 관리",
};

export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

const typeOptions = [
  {
    value: "ALBUM",
    label: "앨범 심의",
    description: "방송국별 음반 접수",
  },
  {
    value: "MV_DISTRIBUTION",
    label: "뮤비 온라인 심의",
    description: "유통사 제출, 온라인 업로드용",
  },
  {
    value: "MV_BROADCAST",
    label: "뮤비 방송용 심의",
    description: "TV 송출 목적 접수",
  },
] as const;

type SubmissionTypeFilter = (typeof typeOptions)[number]["value"];

const defaultSubmissionType: SubmissionTypeFilter = "ALBUM";

const isSubmissionTypeFilter = (value: string): value is SubmissionTypeFilter =>
  typeOptions.some((option) => option.value === value);

const typeLabelMap: Record<string, string> = Object.fromEntries(
  typeOptions.map((option) => [option.value, option.label]),
);

const labelMap = {
  status: reviewStatusLabelMap,
  payment: paymentStatusLabelMap,
  type: typeLabelMap,
} as const;

const statusToneMap: Record<ReviewStatus, string> = {
  DRAFT:
    "border-border bg-background text-muted-foreground",
  SUBMITTED:
    "border-[#1556a4]/30 bg-[#1556a4]/10 text-[#1556a4] dark:border-[#3f8ad8]/35 dark:bg-[#3f8ad8]/15 dark:text-[#8bc3ff]",
  PRE_REVIEW:
    "border-[#1556a4]/30 bg-[#1556a4]/10 text-[#1556a4] dark:border-[#3f8ad8]/35 dark:bg-[#3f8ad8]/15 dark:text-[#8bc3ff]",
  WAITING_PAYMENT:
    "border-[#f2cf27] bg-[#f2cf27]/35 text-[#111111] dark:text-[#f7f5ef]",
  IN_PROGRESS:
    "border-[#1556a4]/35 bg-[#1556a4]/12 text-[#1556a4] dark:border-[#3f8ad8]/35 dark:bg-[#3f8ad8]/15 dark:text-[#8bc3ff]",
  RESULT_READY:
    "border-[#1f7a5a]/35 bg-[#1f7a5a]/12 text-[#1f7a5a] dark:text-[#75d2a5]",
  COMPLETED:
    "border-[#1f7a5a]/35 bg-[#1f7a5a]/12 text-[#1f7a5a] dark:text-[#75d2a5]",
};

const paymentToneMap: Record<PaymentStatus, string> = {
  UNPAID:
    "border-border bg-background text-muted-foreground",
  PAYMENT_PENDING:
    "border-[#f2cf27] bg-[#f2cf27]/35 text-[#111111] dark:text-[#f7f5ef]",
  PAID:
    "border-[#1f7a5a]/35 bg-[#1f7a5a]/12 text-[#1f7a5a] dark:text-[#75d2a5]",
  REFUNDED:
    "border-[#d9362c]/35 bg-[#d9362c]/10 text-[#d9362c] dark:text-[#ff8b83]",
};

function StatusBadge({
  label,
  tone,
}: {
  label: string;
  tone: string;
}) {
  return (
    <span
      className={`inline-flex min-h-7 max-w-full items-center rounded-[6px] border px-2.5 py-1 text-[11px] font-black tracking-normal ${tone}`}
    >
      <span className="truncate">{label}</span>
    </span>
  );
}

function FieldLabel({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="grid min-w-0 gap-1">
      <span className="text-[11px] font-black uppercase tracking-normal text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

type AdminSubmissionsSearchParamsInput = {
  status?: string | string[];
  payment?: string | string[];
  type?: string | string[];
  origin?: string | string[];
  q?: string | string[];
  from?: string | string[];
  to?: string | string[];
  page?: string | string[];
};

type SubmissionRow = {
  id: string;
  title: string | null;
  artist_name: string | null;
  status: ReviewStatus;
  payment_status: PaymentStatus | null;
  type: string;
  created_at: string;
  updated_at: string | null;
  amount_krw: number | null;
  locale?: string | null;
  applicant_country?: string | null;
  payment_provider?: string | null;
  payment_currency?: string | null;
  payment_amount?: number | null;
  created_from?: string | null;
  package?:
    | Array<{ name?: string | null }>
    | { name?: string | null }
    | null;
  guest_name?: string | null;
};

const toSingle = (value?: string | string[]) => {
  if (Array.isArray(value)) return value[0]?.trim() ?? "";
  return value?.trim() ?? "";
};

const toDateInputValue = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";

export default async function AdminSubmissionsPage({
  searchParams,
}: {
  searchParams?: Promise<AdminSubmissionsSearchParamsInput> | AdminSubmissionsSearchParamsInput;
}) {
  const resolvedSearchParams = await Promise.resolve(searchParams ?? {});
  const requestedType = toSingle(resolvedSearchParams.type);
  const activeType = isSubmissionTypeFilter(requestedType)
    ? requestedType
    : defaultSubmissionType;
  const filters = {
    status: toSingle(resolvedSearchParams.status),
    payment: toSingle(resolvedSearchParams.payment),
    type: activeType,
    origin: toSingle(resolvedSearchParams.origin),
    q: toSingle(resolvedSearchParams.q),
    from: toDateInputValue(toSingle(resolvedSearchParams.from)),
    to: toDateInputValue(toSingle(resolvedSearchParams.to)),
    page: toSingle(resolvedSearchParams.page),
  };
  const supabase = await createServerSupabase();
  const page =
    filters.page && Number(filters.page) > 1
      ? Math.floor(Number(filters.page))
      : 1;
  const offset = (page - 1) * PAGE_SIZE;
  const baseSelect =
    "id, title, artist_name, status, payment_status, type, created_at, updated_at, amount_krw, package:packages ( name )";
  const globalSelect =
    "id, title, artist_name, status, payment_status, type, created_at, updated_at, amount_krw, locale, applicant_country, payment_provider, payment_currency, payment_amount, created_from, package:packages ( name )";
  const globalGuestSelect = `${globalSelect}, guest_name`;

  const buildQuery = (
    selectFields: string,
    includeGuestColumns: boolean,
    includeGlobalColumns: boolean,
  ) => {
    let query = supabase
      .from("submissions")
      .select(selectFields, { count: "exact" })
      .order("updated_at", { ascending: false })
      .order("created_at", { ascending: false });

    if (filters.status) {
      query = query.eq("status", filters.status);
    } else {
      query = query.neq("status", "DRAFT");
    }
    if (filters.payment) {
      query = query.eq("payment_status", filters.payment);
    }
    query = query.eq("type", activeType);
    if (includeGlobalColumns && filters.origin === "global") {
      query = query.eq("created_from", "global");
    } else if (includeGlobalColumns && filters.origin === "domestic") {
      query = query.or("created_from.is.null,created_from.eq.domestic");
    }
    if (filters.q) {
      const terms = [
        `title.ilike.%${filters.q}%`,
        `artist_name.ilike.%${filters.q}%`,
      ];
      if (includeGuestColumns) {
        terms.push(`guest_name.ilike.%${filters.q}%`);
      }
      query = query.or(terms.join(","));
    }
    if (filters.from) {
      const from = `${filters.from}T00:00:00.000Z`;
      query = query.gte("created_at", from);
    }
    if (filters.to) {
      const to = `${filters.to}T23:59:59.999Z`;
      query = query.lte("created_at", to);
    }

    return query.range(offset, offset + PAGE_SIZE - 1);
  };

  let hasGuestColumns = true;
  let submissions: SubmissionRow[] = [];
  let submissionsError = null as { message?: string; code?: string } | null;
  let totalCount = 0;

  const guestResult = await buildQuery(globalGuestSelect, true, true);
  submissionsError = guestResult.error ?? null;
  submissions = (guestResult.data ?? []) as unknown as SubmissionRow[];
  totalCount = guestResult.count ?? 0;

  if (
    submissionsError?.message?.toLowerCase().includes("guest_name") ||
    submissionsError?.message?.toLowerCase().includes("created_from") ||
    submissionsError?.message?.toLowerCase().includes("locale") ||
    submissionsError?.code === "PGRST204" ||
    submissionsError?.code === "42703"
  ) {
    hasGuestColumns = false;
    const fallback = await buildQuery(baseSelect, false, false);
    submissions = (fallback.data ?? []) as unknown as SubmissionRow[];
    submissionsError = fallback.error ?? null;
    totalCount = fallback.count ?? totalCount;
  }

  const totalPages =
    totalCount > 0 ? Math.max(1, Math.ceil(totalCount / PAGE_SIZE)) : 1;
  const activeTypeLabel = typeLabelMap[activeType] ?? activeType;

  const buildTypeHref = (type: SubmissionTypeFilter) => {
    const params = new URLSearchParams(
      Object.entries(filters).filter(
        ([key, value]) =>
          key !== "type" && typeof value === "string" && value.length > 0,
      ) as Array<[string, string]>,
    );
    params.delete("page");
    params.set("type", type);
    return `/admin/submissions?${params.toString()}`;
  };

  const buildStatusHref = (status?: string) => {
    const params = new URLSearchParams(
      Object.entries(filters).filter(
        ([, value]) => typeof value === "string" && value.length > 0,
      ) as Array<[string, string]>,
    );
    params.delete("page");
    if (status) {
      params.set("status", status);
    } else {
      params.delete("status");
    }
    const query = params.toString();
    return query ? `/admin/submissions?${query}` : "/admin/submissions";
  };

  const isDraftView = filters.status === "DRAFT";
  const reviewDocSelectableIds =
    activeType === "ALBUM" ? submissions.map((submission) => submission.id) : [];

  const buildPageHref = (targetPage: number) => {
    const params = new URLSearchParams(
      Object.entries(filters).filter(
        ([, value]) => typeof value === "string" && value.length > 0,
      ) as Array<[string, string]>,
    );
    params.set("page", String(targetPage));
    return `/admin/submissions?${params.toString()}`;
  };

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
      <div className="border-b-2 border-[#111111] pb-5 dark:border-[#f2cf27]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <p className="bauhaus-kicker">관리자</p>
            <h1 className="font-display mt-3 text-2xl font-black leading-tight text-foreground sm:text-3xl">
              접수 관리
            </h1>
            <p className="mt-2 text-sm font-semibold text-muted-foreground">
              {activeTypeLabel} · 총 {totalCount.toLocaleString()}건 · 페이지 {page} / {totalPages}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/admin/config"
              className="inline-flex h-10 items-center gap-2 rounded-[8px] border-2 border-border bg-card px-3 text-xs font-black text-foreground transition hover:border-[#111111] dark:hover:border-[#f2cf27]"
            >
              <Settings className="h-4 w-4" aria-hidden="true" />
              <span>패키지/방송국</span>
            </Link>
            <Link
              href={buildStatusHref(isDraftView ? undefined : "DRAFT")}
              className="inline-flex h-10 items-center gap-2 rounded-[8px] border-2 border-[#111111] bg-[#f2cf27] px-3 text-xs font-black text-[#111111] shadow-[3px_3px_0_#111111] transition hover:-translate-y-0.5 dark:border-[#f2cf27] dark:shadow-none"
            >
              {isDraftView ? (
                <FileText className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Archive className="h-4 w-4" aria-hidden="true" />
              )}
              <span>{isDraftView ? "제출된 항목" : "임시 저장"}</span>
            </Link>
          </div>
        </div>
      </div>

      <nav
        aria-label="심의 유형"
        className="mt-5 grid gap-3 md:grid-cols-3"
      >
        {typeOptions.map((option) => {
          const isActive = option.value === activeType;
          return (
            <Link
              key={option.value}
              href={buildTypeHref(option.value)}
              aria-current={isActive ? "page" : undefined}
              className={[
                "min-h-[96px] rounded-[10px] border-2 p-4 text-left transition",
                isActive
                  ? "border-[#111111] bg-[#f2cf27] text-[#111111] shadow-[5px_5px_0_#111111] dark:border-[#f2cf27] dark:shadow-none"
                  : "border-border bg-card text-foreground hover:border-[#111111] dark:hover:border-[#f2cf27]",
              ].join(" ")}
            >
              <span className="text-[11px] font-black uppercase tracking-normal opacity-70">
                접수 관리
              </span>
              <span className="mt-2 block text-base font-black leading-6">
                {option.label}
              </span>
              <span className="mt-1 block text-xs font-semibold opacity-75">
                {option.description}
              </span>
            </Link>
          );
        })}
      </nav>

      <form
        method="get"
        className="mt-5 rounded-[10px] border-2 border-[#111111] bg-card p-4 shadow-[5px_5px_0_#111111] dark:border-[#f2cf27] dark:shadow-[5px_5px_0_#f2cf27]"
      >
        <input type="hidden" name="type" value={activeType} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <FieldLabel label="검색">
            <div className="relative min-w-0">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <input
                name="q"
                defaultValue={filters.q}
                placeholder="제목, 아티스트, 비회원명"
                className="h-11 w-full min-w-0 rounded-[8px] border-2 border-border bg-background px-9 text-sm font-semibold text-foreground outline-none transition focus:border-[#1556a4]"
              />
            </div>
          </FieldLabel>
          <FieldLabel label="시작일">
            <input
              type="date"
              name="from"
              defaultValue={filters.from}
              className="h-11 w-full min-w-0 rounded-[8px] border-2 border-border bg-background px-3 text-sm font-semibold text-foreground outline-none transition focus:border-[#1556a4]"
            />
          </FieldLabel>
          <FieldLabel label="종료일">
            <input
              type="date"
              name="to"
              defaultValue={filters.to}
              className="h-11 w-full min-w-0 rounded-[8px] border-2 border-border bg-background px-3 text-sm font-semibold text-foreground outline-none transition focus:border-[#1556a4]"
            />
          </FieldLabel>
          <FieldLabel label="접수">
            <select
              name="origin"
              defaultValue={filters.origin}
              className="h-11 w-full min-w-0 rounded-[8px] border-2 border-border bg-background px-3 text-sm font-semibold text-foreground outline-none transition focus:border-[#1556a4]"
            >
              <option value="">전체 접수</option>
              <option value="domestic">국내</option>
              <option value="global">해외</option>
            </select>
          </FieldLabel>
          <FieldLabel label="상태">
            <select
              name="status"
              defaultValue={filters.status}
              className="h-11 w-full min-w-0 rounded-[8px] border-2 border-border bg-background px-3 text-sm font-semibold text-foreground outline-none transition focus:border-[#1556a4]"
            >
              <option value="">전체 상태</option>
              {reviewStatusOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </FieldLabel>
          <FieldLabel label="결제">
            <select
              name="payment"
              defaultValue={filters.payment}
              className="h-11 w-full min-w-0 rounded-[8px] border-2 border-border bg-background px-3 text-sm font-semibold text-foreground outline-none transition focus:border-[#1556a4]"
            >
              <option value="">결제 상태</option>
              {paymentStatusOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </FieldLabel>
          <button
            type="submit"
            className="inline-flex h-11 w-full items-center justify-center gap-2 self-end rounded-[8px] border-2 border-[#111111] bg-[#111111] px-4 text-xs font-black text-white transition hover:bg-[#1556a4] dark:border-[#f2cf27] dark:bg-[#f2cf27] dark:text-[#111111] lg:w-auto"
          >
            <Filter className="h-4 w-4" aria-hidden="true" />
            <span>필터 적용</span>
          </button>
        </div>
      </form>

      <div className="mt-4 flex flex-col gap-3 text-xs font-bold text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <span>
          {activeTypeLabel} · {isDraftView ? "임시 저장 항목 표시 중" : "제출된 항목 표시 중"}
        </span>
        <div className="flex items-center gap-2 sm:justify-end">
          <Link
            href={buildPageHref(Math.max(1, page - 1))}
            aria-disabled={page <= 1}
            className={`inline-flex h-9 min-w-9 items-center justify-center rounded-[8px] border-2 px-3 transition ${
              page <= 1
                ? "pointer-events-none border-border/60 text-muted-foreground opacity-50"
                : "border-border bg-card text-foreground hover:border-[#111111] dark:hover:border-[#f2cf27]"
            }`}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">이전</span>
          </Link>
          <span className="rounded-[8px] border-2 border-border bg-background px-3 py-2 text-[11px] text-foreground">
            {page} / {totalPages}
          </span>
          <Link
            href={buildPageHref(Math.min(totalPages, page + 1))}
            aria-disabled={page >= totalPages}
            className={`inline-flex h-9 min-w-9 items-center justify-center rounded-[8px] border-2 px-3 transition ${
              page >= totalPages
                ? "pointer-events-none border-border/60 text-muted-foreground opacity-50"
                : "border-border bg-card text-foreground hover:border-[#111111] dark:hover:border-[#f2cf27]"
            }`}
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">다음</span>
          </Link>
        </div>
      </div>

      <ReviewDocsSelectionProvider ids={reviewDocSelectableIds}>
      {activeType === "ALBUM" ? <ReviewDocsBulkToolbar /> : null}

      <div className="mt-6 space-y-3">
        {submissionsError && (
          <div className="rounded-2xl border border-dashed border-red-500/40 bg-red-500/10 px-4 py-3 text-xs text-red-600">
            접수 목록을 불러오지 못했습니다. ({submissionsError.message})
          </div>
        )}
        {submissions && submissions.length > 0 ? (
          submissions.map((submission) => {
            const packageInfo = Array.isArray(submission.package)
              ? submission.package[0]
              : submission.package;
            const paymentStatusLabel = submission.payment_status
              ? labelMap.payment[submission.payment_status] ??
                submission.payment_status
              : "-";
            const statusLabel =
              labelMap.status[submission.status] ?? submission.status;
            const typeLabel = labelMap.type[submission.type] ?? submission.type;
            const isGlobalSubmission =
              submission.created_from === "global" ||
              submission.locale === "en" ||
              submission.payment_provider === "paypal";
            const amountLabel = submission.amount_krw
              ? `${submission.amount_krw.toLocaleString()}원`
              : submission.payment_amount
                ? `${submission.payment_currency ?? "USD"} ${Number(
                    submission.payment_amount,
                  ).toLocaleString()}`
                : "-";
            return (
              <article
                key={submission.id}
                className="rounded-[10px] border-2 border-border bg-card p-4 text-sm transition hover:border-[#111111] dark:hover:border-[#f2cf27]"
              >
                <div
                  className={[
                    "grid min-w-0 gap-4 lg:items-center",
                    activeType === "ALBUM"
                      ? "lg:grid-cols-[auto_minmax(0,1.45fr)_minmax(190px,0.75fr)_minmax(190px,0.75fr)_auto]"
                      : "lg:grid-cols-[minmax(0,1.45fr)_minmax(190px,0.75fr)_minmax(190px,0.75fr)_auto]",
                  ].join(" ")}
                >
                  {activeType === "ALBUM" ? (
                    <ReviewDocsRowCheckbox
                      id={submission.id}
                      label={submission.title || "제목 미입력"}
                    />
                  ) : null}
                  <div className="min-w-0">
                    <Link
                      prefetch={false}
                      href={`/admin/submissions/${submission.id}`}
                      className="block min-w-0 text-base font-black leading-6 text-foreground hover:underline"
                    >
                      <span className="block truncate">
                        {submission.title || "제목 미입력"}
                      </span>
                    </Link>
                    <p className="mt-1 truncate text-xs font-semibold text-muted-foreground">
                      {submission.artist_name || "아티스트 미입력"} · {typeLabel}
                      {hasGuestColumns && submission.guest_name
                        ? ` · ${submission.guest_name}`
                        : ""}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {isGlobalSubmission ? (
                        <span className="rounded-[6px] border-2 border-[#111111] bg-[#f2cf27] px-2 py-0.5 text-[10px] font-black text-[#111111]">
                          GLOBAL
                        </span>
                      ) : null}
                      {hasGuestColumns && submission.guest_name ? (
                        <span className="rounded-[6px] border border-border bg-background px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                          비회원
                        </span>
                      ) : null}
                      {submission.applicant_country ? (
                        <span className="rounded-[6px] border border-border bg-background px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                          {submission.applicant_country}
                        </span>
                      ) : null}
                      {submission.payment_provider ? (
                        <span className="rounded-[6px] border border-border bg-background px-2 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
                          {submission.payment_provider}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="grid min-w-0 gap-2">
                    <span className="text-[10px] font-black uppercase tracking-normal text-muted-foreground">
                      상태
                    </span>
                    <div className="flex min-w-0 flex-wrap gap-1.5">
                      <StatusBadge
                        label={statusLabel}
                        tone={statusToneMap[submission.status]}
                      />
                      {submission.payment_status ? (
                        <StatusBadge
                          label={paymentStatusLabel}
                          tone={paymentToneMap[submission.payment_status]}
                        />
                      ) : null}
                    </div>
                  </div>
                  <div className="min-w-0 text-xs font-semibold text-muted-foreground lg:text-right">
                    <p className="truncate text-foreground">
                      {packageInfo?.name ?? "패키지 미지정"}
                    </p>
                    <p className="mt-1 truncate">
                      업데이트:{" "}
                      {formatDateTime(submission.updated_at ?? submission.created_at)}
                    </p>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row lg:flex-col lg:items-end">
                    <div className="rounded-[8px] border-2 border-border bg-background px-3 py-2 text-right text-xs font-black text-foreground">
                      {amountLabel}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                      <Link
                        prefetch={false}
                        href={`/admin/submissions/${submission.id}`}
                        className="inline-flex h-9 items-center justify-center rounded-[8px] border-2 border-border bg-background px-3 text-[11px] font-black text-foreground transition hover:border-[#111111] dark:hover:border-[#f2cf27]"
                      >
                        상세보기
                      </Link>
                      <AdminDeleteButton
                        ids={[submission.id]}
                        className="inline-flex h-9 items-center justify-center rounded-[8px] border-2 border-rose-200/80 bg-background px-3 text-[11px] font-black text-rose-600 transition hover:border-rose-500 hover:bg-rose-500/10 hover:text-rose-700"
                      />
                    </div>
                  </div>
                </div>
              </article>
            );
          })
        ) : (
          <div className="rounded-2xl border border-dashed border-border/60 bg-background/70 px-4 py-6 text-xs text-muted-foreground">
            조회된 접수가 없습니다.
          </div>
        )}
      </div>
      </ReviewDocsSelectionProvider>
    </div>
  );
}
