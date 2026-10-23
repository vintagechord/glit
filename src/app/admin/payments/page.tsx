import Link from "next/link";

import { requireAdminPage } from "@/lib/admin/page-auth";
import { formatDateTime, formatCurrency } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata = {
  title: "카드 결제 확인",
};

export const dynamic = "force-dynamic";

type PaymentRow = {
  order_id: string;
  submission_id: string | null;
  amount_krw: number | null;
  status: string | null;
  paid_at: string | null;
  pg_tid: string | null;
  result_code: string | null;
  result_message: string | null;
  created_at: string | null;
  submission: {
    id: string;
    title: string | null;
    artist_name: string | null;
    payment_method: string | null;
    payment_status: string | null;
  } | null;
};

const filters = [
  ["all", "전체"], ["attention", "승인 확인 필요"], ["APPROVED", "승인 완료"],
  ["REQUESTED", "요청·처리 중"], ["FAILED", "실패"], ["CANCELED", "취소"],
] as const;
const attentionCodes = ["APPROVAL_IN_PROGRESS", "CAPTURE_IN_PROGRESS", "APPROVAL_UNCERTAIN", "REVIEW_REQUIRED"];
const pageSize = 100;

export default async function AdminPaymentsPage({ searchParams }: {
  searchParams: Promise<{ filter?: string; page?: string }>;
}) {
  await requireAdminPage();
  const params = await searchParams;
  const filter = filters.some(([value]) => value === params.filter) ? params.filter! : "all";
  const requestedPage = Number(params.page);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 && requestedPage <= 10000 ? requestedPage : 1;
  const pageHref = (number: number) => `/admin/payments?filter=${encodeURIComponent(filter)}&page=${number}`;
  const admin = createAdminClient();
  let query = admin
    .from("submission_payments")
    .select(
      `
        order_id,
        submission_id,
        amount_krw,
        status,
        paid_at,
        pg_tid,
        result_code,
        result_message,
        created_at,
        submission:submissions (
          id,
          title,
          artist_name,
          payment_method,
          payment_status
        )
      `, { count: "exact" },
    );
  if (filter === "attention") query = query.in("result_code", attentionCodes);
  else if (filter !== "all") query = query.eq("status", filter);
  const { data, error, count } = await query.order("created_at", { ascending: false })
    .order("order_id", { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1);

  const rows = (data ?? []) as unknown as PaymentRow[];

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-12">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl text-foreground">
            카드 결제
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">승인·실패·확인 중 거래를 주문번호와 TID로 대조합니다. 이 화면은 결제나 환불을 실행하지 않습니다.</p>
        </div>
        <Link
          href="/admin/submissions?type=ALBUM"
          className="rounded-full border border-border/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-foreground"
        >
          접수 관리
        </Link>
      </div>
      <p className="mt-5 rounded-xl border border-border p-4 text-sm">
        승인 확인 필요 건은 이니시스 관리자 거래 내역과 신청·주문 상태를 먼저 대조해주세요. 확인 전에는 재결제를 안내하지 마세요.
        {" "}<Link href="/admin/submissions?type=ALL&payment=REFUNDED" className="font-semibold underline underline-offset-2">환불로 기록된 신청 확인</Link>
        {" "}(PG 취소 완료 여부는 별도 대조)
      </p>
      <nav aria-label="결제 상태 필터" className="mt-5 flex flex-wrap gap-2">
        {filters.map(([value, label]) => <Link key={value} href={`/admin/payments?filter=${value}`} aria-current={filter === value ? "page" : undefined}
          className={`inline-flex min-h-11 items-center rounded-lg border px-4 py-2 text-sm font-semibold ${filter === value ? "border-foreground bg-foreground text-background" : "border-border"}`}>{label}</Link>)}
      </nav>
      <p className="mt-3 text-sm text-muted-foreground">{page}페이지 · {error ? "집계 확인 필요" : `전체 ${count ?? 0}건`} · 페이지당 최대 {pageSize}건</p>

      {error ? (
        <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          <p className="font-semibold">결제 내역을 불러오지 못했습니다.</p>
          <p className="mt-1">잠시 후 다시 불러오고, 문제가 계속되면 관리자 로그를 확인해주세요.</p>
        </div>
      ) : null}

      <div
        className="mt-6 overflow-auto rounded-2xl border border-border/60 bg-card/70"
        role="region"
        aria-label="카드 결제 대조 목록"
        tabIndex={0}
      >
        <table className="min-w-full text-sm">
          <caption className="sr-only">이니시스 카드 결제 상태와 결과 코드</caption>
          <thead className="bg-card/80 text-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-left">주문번호</th>
              <th className="px-4 py-3 text-left">승인 TID</th>
              <th className="px-4 py-3 text-left">결제 금액</th>
              <th className="px-4 py-3 text-left">승인·요청 시각</th>
              <th className="px-4 py-3 text-left">제목 / 아티스트</th>
              <th className="px-4 py-3 text-left">접수 ID</th>
              <th className="px-4 py-3 text-left">상태</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="px-4 py-6 text-center text-muted-foreground" colSpan={7}>
                  {error ? "목록을 확인하지 못했습니다." : "선택한 상태의 결제 건이 없습니다."}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.order_id} className="border-t border-border/50">
                  <td className="px-4 py-3 font-mono text-xs text-foreground">{row.order_id}</td>
                  <td className="px-4 py-3 font-mono text-[11px] text-muted-foreground">
                    {row.pg_tid || "—"}
                  </td>
                  <td className="px-4 py-3 text-foreground">
                    {row.amount_krw != null ? formatCurrency(row.amount_krw) : "—"}
                  </td>
                  <td className="px-4 py-3 text-foreground">
                    {row.paid_at ? formatDateTime(row.paid_at) : row.created_at ? formatDateTime(row.created_at) : "—"}
                  </td>
                  <td className="px-4 py-3 text-foreground">
                    <div className="max-w-xs">
                      <p className="truncate">
                        {row.submission?.title || "제목 없음"}{" "}
                        <span className="text-muted-foreground">/ {row.submission?.artist_name || "아티스트 없음"}</span>
                      </p>
                      {row.result_message ? (
                        <p className="text-[11px] text-muted-foreground line-clamp-1">{row.result_message}</p>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-foreground">
                    {row.submission_id ? (
                      <Link
                        href={`/admin/submissions/${row.submission_id}`}
                        className="text-foreground underline underline-offset-2"
                      >
                        {row.submission_id}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3 text-foreground">
                    <div className="text-xs">
                      <p className={`font-semibold ${row.status === "APPROVED" && !attentionCodes.includes(row.result_code ?? "") ? "text-emerald-700 dark:text-emerald-300" : "text-amber-800 dark:text-amber-300"}`}>{row.status ?? "확인 필요"}</p>
                      <p className="break-all font-mono">{row.result_code || "—"}</p>
                      <p className="text-muted-foreground">
                        {row.submission?.payment_method ?? "CARD"} / {row.submission?.payment_status ?? "신청 상태 확인 필요"}
                      </p>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <nav aria-label="결제 목록 페이지" className="mt-5 flex gap-4 text-sm font-semibold">
        {page > 1 && <Link href={pageHref(page - 1)} className="inline-flex min-h-11 items-center underline">이전 페이지</Link>}
        {!error && page * pageSize < (count ?? 0) && <Link href={pageHref(page + 1)} className="inline-flex min-h-11 items-center underline">다음 페이지</Link>}
      </nav>
    </div>
  );
}
