import Link from "next/link";

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

export const metadata = {
  title: "접수 관리",
};

export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

const typeOptions = [
  { value: "ALBUM", label: "음반 심의" },
  { value: "MV_DISTRIBUTION", label: "뮤직비디오 심의 (유통/온라인)" },
  { value: "MV_BROADCAST", label: "뮤직비디오 심의 (TV 송출)" },
];

const typeLabelMap: Record<string, string> = Object.fromEntries(
  typeOptions.map((option) => [option.value, option.label]),
);

const labelMap = {
  status: reviewStatusLabelMap,
  payment: paymentStatusLabelMap,
  type: typeLabelMap,
} as const;

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
  const filters = {
    status: toSingle(resolvedSearchParams.status),
    payment: toSingle(resolvedSearchParams.payment),
    type: toSingle(resolvedSearchParams.type),
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
    if (filters.type) {
      query = query.eq("type", filters.type);
    }
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
    <div className="mx-auto w-full max-w-6xl px-6 py-12">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
            관리자
          </p>
          <h1 className="font-display mt-2 text-3xl text-foreground">
            접수 관리
          </h1>
      </div>
      <Link
        href="/admin/config"
        className="rounded-full border border-border/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-foreground"
      >
        패키지/방송국 설정
      </Link>
      <Link
        href={buildStatusHref(isDraftView ? undefined : "DRAFT")}
        className="rounded-full border border-border/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-foreground"
      >
        {isDraftView ? "제출된 항목 보기" : "임시 저장 보기"}
      </Link>
    </div>

      <form
        method="get"
        className="mt-6 grid gap-4 rounded-[28px] border border-border/60 bg-card/80 p-6 md:grid-cols-[1fr_repeat(6,auto)_auto]"
      >
        <input
          name="q"
          defaultValue={filters.q}
          placeholder="검색어 (제목/아티스트)"
          className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm"
        />
        <input
          type="date"
          name="from"
          defaultValue={filters.from}
          className="rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm"
        />
        <input
          type="date"
          name="to"
          defaultValue={filters.to}
          className="rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm"
        />
        <select
          name="type"
          defaultValue={filters.type}
          className="rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm"
        >
          <option value="">전체 유형</option>
            {typeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
        </select>
        <select
          name="origin"
          defaultValue={filters.origin}
          className="rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm"
        >
          <option value="">전체 접수</option>
          <option value="domestic">국내</option>
          <option value="global">해외</option>
        </select>
        <select
          name="status"
          defaultValue={filters.status}
          className="rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm"
        >
          <option value="">전체 상태</option>
          {reviewStatusOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <select
          name="payment"
          defaultValue={filters.payment}
          className="rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm"
        >
          <option value="">결제 상태</option>
          {paymentStatusOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded-full bg-foreground px-5 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-background"
        >
          필터 적용
        </button>
      </form>

      <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
        <span>
          총 {totalCount.toLocaleString()}건 · 페이지 {page} / {totalPages}
        </span>
        <div className="flex items-center gap-2">
          <Link
            href={buildPageHref(Math.max(1, page - 1))}
            aria-disabled={page <= 1}
            className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] transition ${
              page <= 1
                ? "cursor-not-allowed border-border/60 text-muted-foreground"
                : "border-border/70 text-foreground hover:border-foreground"
            }`}
          >
            이전
          </Link>
          <Link
            href={buildPageHref(Math.min(totalPages, page + 1))}
            aria-disabled={page >= totalPages}
            className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] transition ${
              page >= totalPages
                ? "cursor-not-allowed border-border/60 text-muted-foreground"
                : "border-border/70 text-foreground hover:border-foreground"
            }`}
          >
            다음
          </Link>
        </div>
      </div>

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
            const isGlobalSubmission =
              submission.created_from === "global" ||
              submission.locale === "en" ||
              submission.payment_provider === "paypal";
            return (
              <div
                key={submission.id}
                className="rounded-2xl border border-border/60 bg-card/80 p-4 text-sm transition hover:border-foreground"
              >
                <div className="grid gap-4 md:grid-cols-[1.4fr_1fr_1fr_0.9fr]">
                  <div>
                    <Link
                      prefetch={false}
                      href={`/admin/submissions/${submission.id}`}
                      className="font-semibold text-foreground hover:underline"
                    >
                      {submission.title || "제목 미입력"}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {submission.artist_name || "아티스트 미입력"} ·{" "}
                      {labelMap.type[submission.type] ?? submission.type}
                      {hasGuestColumns && submission.guest_name ? " · 비회원" : ""}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {isGlobalSubmission ? (
                        <span className="rounded-[6px] border-2 border-[#111111] bg-[#f2cf27] px-2 py-0.5 text-[10px] font-black text-[#111111]">
                          GLOBAL
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
                  <div className="text-xs text-muted-foreground">
                    <p>
                      상태: {labelMap.status[submission.status] ?? submission.status}
                    </p>
                    <p>
                      결제: {paymentStatusLabel}
                    </p>
                    <p>결과: -</p>
                  </div>
                  <div className="text-xs text-muted-foreground md:text-right">
                    <p>{packageInfo?.name ?? "-"}</p>
                    <p>
                      업데이트:{" "}
                      {formatDateTime(submission.updated_at ?? submission.created_at)}
                    </p>
                  </div>
                  <div className="text-xs text-muted-foreground md:text-right">
                    <p>
                      {submission.amount_krw
                        ? `${submission.amount_krw.toLocaleString()}원`
                        : submission.payment_amount
                          ? `${submission.payment_currency ?? "USD"} ${Number(
                              submission.payment_amount,
                            ).toLocaleString()}`
                        : "-"}
                    </p>
                    <p className="text-foreground">상세 보기 →</p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 md:justify-end">
                  <Link
                    prefetch={false}
                    href={`/admin/submissions/${submission.id}`}
                    className="rounded-full border border-border/70 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-foreground"
                  >
                    상세보기
                  </Link>
                  <AdminDeleteButton ids={[submission.id]} />
                </div>
              </div>
            );
          })
        ) : (
          <div className="rounded-2xl border border-dashed border-border/60 bg-background/70 px-4 py-6 text-xs text-muted-foreground">
            조회된 접수가 없습니다.
          </div>
        )}
      </div>
    </div>
  );
}
