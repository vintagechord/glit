import Link from "next/link";

import { formatDateTime, formatCurrency } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata = {
  title: "이니시스 승인 내역",
};

export const dynamic = "force-dynamic";

type PaymentRow = {
  order_id: string;
  submission_id: string | null;
  amount_krw: number | null;
  status: string | null;
  paid_at: string | null;
  pg_tid: string | null;
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

export default async function AdminPaymentsPage() {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("submission_payments")
    .select(
      "order_id, submission_id, amount_krw, status, paid_at, pg_tid, result_message, created_at, submission:submissions ( id, title, artist_name, payment_method, payment_status )",
    )
    .eq("status", "APPROVED")
    .order("paid_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(200);

  const rows = (data ?? []) as PaymentRow[];

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-12">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
            관리자
          </p>
          <h1 className="font-display mt-2 text-3xl text-foreground">
            이니시스 카드 결제 (승인 완료)
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            STDPay 승인 완료 건을 최신 순으로 표시합니다. 최대 200건까지 조회됩니다.
          </p>
        </div>
        <Link
          href="/admin/submissions"
          className="rounded-full border border-border/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-foreground"
        >
          접수 관리로 이동
        </Link>
      </div>

      {error ? (
        <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          <p className="font-semibold">결제 내역을 불러오지 못했습니다.</p>
          <p className="mt-1 text-xs text-red-500">{error.message}</p>
        </div>
      ) : null}

      <div className="mt-6 overflow-auto rounded-2xl border border-border/60 bg-card/70">
        <table className="min-w-full text-sm">
          <thead className="bg-card/80 text-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-left">주문번호</th>
              <th className="px-4 py-3 text-left">승인 TID</th>
              <th className="px-4 py-3 text-left">결제 금액</th>
              <th className="px-4 py-3 text-left">승인 시각</th>
              <th className="px-4 py-3 text-left">제목 / 아티스트</th>
              <th className="px-4 py-3 text-left">접수 ID</th>
              <th className="px-4 py-3 text-left">상태</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="px-4 py-6 text-center text-muted-foreground" colSpan={7}>
                  승인 완료된 결제 건이 없습니다.
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
                      <p className="font-semibold text-emerald-600">{row.status ?? "?"}</p>
                      <p className="text-muted-foreground">
                        {row.submission?.payment_method ?? "CARD"} / {row.submission?.payment_status ?? "APPROVED"}
                      </p>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
