import Link from "next/link";

import {
  cancelCashReceiptAction,
  issueCashReceiptAction,
  recordManualCashReceiptAction,
  resolveUncertainCashReceiptAction,
} from "@/features/admin/cash-receipt-actions";
import { requireAdminPage } from "@/lib/admin/page-auth";
import {
  CASH_RECEIPT_ATTENTION_LABELS,
  CASH_RECEIPT_PURPOSE_LABELS,
  CASH_RECEIPT_STATUS_LABELS,
  cashReceiptAttention,
  formatCashReceiptIdentifier,
  splitVatInclusiveAmount,
  type CashReceiptAttention,
  type CashReceiptStatus,
} from "@/lib/cash-receipts";
import { cashReceiptGoodName, isCashReceiptAutoIssueEnabled, type CashReceiptOrder, type CashReceiptRow } from "@/lib/cash-receipts-server";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata = { title: "현금영수증 발급" };
export const dynamic = "force-dynamic";

type Row = CashReceiptRow & { order: CashReceiptOrder | null };

const filters = [
  ["attention", "처리 필요"], ["waiting", "입금 대기"], ["ISSUED", "발급 완료"], ["CANCELED", "취소"], ["all", "전체"],
] as const;
const savedNotices: Record<string, string> = {
  issued: "이니시스로 현금영수증을 발급했습니다. 고객 주문내역에서 PDF를 받을 수 있습니다.",
  recorded: "승인번호를 저장했습니다. 고객 주문내역에서 PDF를 받을 수 있습니다.",
  canceled: "취소 처리를 저장했습니다.",
  resolvedIssued: "이니시스 발급 내역을 기록했습니다. 고객 주문내역에서 PDF를 받을 수 있습니다.",
  resolvedFailed: "미발급으로 기록했습니다. 다시 발급하거나 승인번호를 직접 입력할 수 있습니다.",
};
const statusTone: Record<CashReceiptStatus, string> = {
  REQUESTED: "bg-[var(--bauhaus-yellow)] text-[#111111]",
  ISSUING: "bg-[var(--bauhaus-yellow)] text-[#111111]",
  ISSUED: "bg-[var(--bauhaus-blue)] text-white",
  FAILED: "bg-[var(--bauhaus-red)] text-white",
  CANCELED: "bg-muted text-foreground",
  UNCERTAIN: "bg-[var(--bauhaus-red)] text-white",
};
const attentionOrder: Record<CashReceiptAttention, number> = { VERIFY: 0, CANCEL_IN_HOMETAX: 1, ISSUE: 2 };
const OPEN_STATUSES = ["REQUESTED", "FAILED", "ISSUING", "UNCERTAIN"];
const ORDER_EMBED = "id,user_id,payment_method,status,amount_krw,paid_at,created_at,depositor_name,items:submission_order_items(submission_id,title,artist_name,type)";
const nowKstInput = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 16);
const inputClass = "min-h-10 rounded-[6px] border-2 border-[var(--bauhaus-ink)] bg-white px-2 text-sm font-semibold text-[#111111]";
const buttonClass = "inline-flex min-h-10 items-center justify-center rounded-[8px] border-2 border-[var(--bauhaus-ink)] px-3 text-xs font-black shadow-[2px_2px_0_#111111] transition hover:-translate-y-0.5";

export default async function AdminCashReceiptsPage({ searchParams }: {
  searchParams: Promise<{ filter?: string; saved?: string; error?: string }>;
}) {
  await requireAdminPage();
  const params = await searchParams;
  const filter = filters.some(([value]) => value === params.filter) ? params.filter! : "attention";
  const autoIssue = isCashReceiptAutoIssueEnabled();
  const admin = createAdminClient();
  const receipts = () => admin.from("submission_order_cash_receipts").select(`*, order:submission_orders(${ORDER_EMBED})`)
    .order("requested_at", { ascending: false }).limit(200);
  let query = receipts();
  if (filter === "attention" || filter === "waiting") query = query.in("status", OPEN_STATUSES);
  else if (filter !== "all") query = query.eq("status", filter);
  // Receipts issued for orders whose money went back stay ISSUED until the
  // Hometax cancellation is recorded; list them however old they are.
  const [{ data, error }, refunded] = await Promise.all([
    query,
    filter === "attention"
      ? admin.from("submission_order_cash_receipts").select(`*, order:submission_orders!inner(${ORDER_EMBED})`)
        .eq("status", "ISSUED").neq("order.status", "PAID").order("requested_at", { ascending: false }).limit(200)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const attentionOf = (row: Row) => cashReceiptAttention(row, row.order?.status);
  const rows = (filter === "attention"
    ? [...((data ?? []) as unknown as Row[]), ...((refunded.data ?? []) as unknown as Row[])]
      .filter((row) => attentionOf(row) !== null)
      .sort((a, b) => attentionOrder[attentionOf(a)!] - attentionOrder[attentionOf(b)!] || b.requested_at.localeCompare(a.requested_at))
    : ((data ?? []) as unknown as Row[]).filter((row) => filter !== "waiting" || row.order?.status === "BANK_PENDING"));
  const loadError = error ?? refunded.error;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-black tracking-[0.2em] text-muted-foreground">CASH RECEIPTS</p>
          <h1 className="mt-2 text-3xl font-black text-foreground">현금영수증 발급</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            무통장 입금 주문의 현금영수증 신청을 처리합니다. 입금을 확인(결제완료)한 주문만 발급할 수 있고, 발급되면 고객이 주문내역에서 PDF를 받습니다. 처리 필요에는 발급할 신청, 이니시스 결과를 확인할 건, 환불·취소된 주문에 발급돼 홈택스 취소가 필요한 건이 모입니다.
          </p>
        </div>
        <Link href="/admin" className={`${buttonClass} bg-background text-foreground`}>관리자 홈</Link>
      </div>

      <div className={`rounded-[10px] border-2 border-[var(--bauhaus-ink)] p-4 text-sm leading-6 ${autoIssue ? "bg-[var(--bauhaus-blue)] text-white" : "bg-[var(--bauhaus-yellow)] text-[#111111]"}`}>
        {autoIssue
          ? "자동 발급 사용 중: 입금을 결제완료로 바꾸면 KG이니시스로 바로 발급합니다. 실패한 건은 아래에서 다시 시도하거나 승인번호를 직접 입력하세요."
          : "자동 발급 미설정: 국세청 홈택스(현금영수증 > 현금영수증 발급)나 이니시스 관리자에서 발급한 뒤 승인번호를 입력하세요. Vercel에 INICIS_INIAPI_KEY_PROD·INICIS_INIAPI_IV_PROD를 등록하면 자동 발급됩니다."}
      </div>

      {params.saved && savedNotices[params.saved] && <div role="status" className="rounded-[10px] border-2 border-[var(--bauhaus-ink)] bg-background p-4 text-sm font-semibold">{savedNotices[params.saved]}</div>}
      {params.error && <div role="alert" className="rounded-[10px] border-2 border-[var(--bauhaus-ink)] bg-[var(--bauhaus-red)] p-4 text-sm font-semibold text-white">{params.error}</div>}

      <nav aria-label="현금영수증 상태" className="flex flex-wrap gap-2">
        {filters.map(([value, label]) => (
          <Link key={value} href={`/admin/cash-receipts?filter=${value}`} aria-current={filter === value ? "page" : undefined}
            className={`${buttonClass} ${filter === value ? "bg-[var(--bauhaus-yellow)] text-[#111111]" : "bg-background text-foreground"}`}>{label}</Link>
        ))}
      </nav>

      {loadError ? (
        <div role="alert" className="rounded-[10px] border-2 border-[var(--bauhaus-ink)] bg-[var(--bauhaus-red)] p-4 text-sm font-semibold text-white">
          현금영수증 목록을 불러오지 못했습니다. 데이터베이스 마이그레이션(20261101120000, 20261103131000) 적용 여부를 확인해주세요.
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded-[10px] border-2 border-[var(--bauhaus-ink)] bg-card p-6 text-sm text-muted-foreground">해당 상태의 현금영수증 신청이 없습니다.</p>
      ) : (
        <div className="space-y-4">
          {rows.map((row) => {
            const order = row.order;
            const amounts = row.amount_krw != null
              ? { totalKrw: row.amount_krw, supplyKrw: row.supply_krw ?? 0, vatKrw: row.vat_krw ?? 0 }
              : splitVatInclusiveAmount(order?.amount_krw ?? 0);
            const paid = order?.status === "PAID";
            const attention = attentionOf(row);
            const verify = attention === "VERIFY";
            const issuable = paid && (row.status === "REQUESTED" || row.status === "FAILED");
            const submissionId = order?.items.find((item) => item.submission_id)?.submission_id;
            return (
              <article key={row.order_id} id={`order-${row.order_id}`} className="rounded-[10px] border-2 border-[var(--bauhaus-ink)] bg-card p-4 shadow-[4px_4px_0_#111111] sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-black [overflow-wrap:anywhere]">{order ? cashReceiptGoodName(order) : "주문 정보 없음"}</p>
                    <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{row.order_id}</p>
                  </div>
                  <span className={`inline-flex rounded-[6px] border-2 border-[var(--bauhaus-ink)] px-2.5 py-1 text-xs font-black ${attention && attention !== "ISSUE" ? statusTone.UNCERTAIN : statusTone[row.status]}`}>{attention && attention !== "ISSUE" ? CASH_RECEIPT_ATTENTION_LABELS[attention] : CASH_RECEIPT_STATUS_LABELS[row.status]}</span>
                </div>
                {verify && <p className="mt-3 rounded-[8px] border-2 border-[var(--bauhaus-ink)] bg-[var(--bauhaus-yellow)] p-3 text-xs font-semibold leading-5 text-[#111111]">
                  이니시스 발급 결과를 받지 못했습니다. 이미 국세청에 등록됐을 수 있으니 다시 발급하지 마세요. 이니시스 관리자 ▶ 현금영수증 발행 내역에서 이 주문을 확인한 뒤 아래에 결과를 기록하세요. 확인 전까지 고객은 신청을 바꾸거나 취소할 수 없습니다.
                </p>}
                {attention === "CANCEL_IN_HOMETAX" && <p className="mt-3 rounded-[8px] border-2 border-[var(--bauhaus-ink)] bg-[var(--bauhaus-yellow)] p-3 text-xs font-semibold leading-5 text-[#111111]">
                  {order?.status === "REFUNDED" ? "환불된" : "취소된"} 주문에 발급된 현금영수증입니다. 홈택스(또는 이니시스 관리자)에서 발급을 취소한 뒤 아래에서 취소 처리를 기록하세요. 기록 전까지 고객 주문내역의 PDF는 내려받을 수 없습니다.
                </p>}
                <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
                  <div><dt className="text-xs text-muted-foreground">용도</dt><dd className="font-semibold">{CASH_RECEIPT_PURPOSE_LABELS[row.purpose]}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">발급 번호</dt><dd className="font-black tabular-nums" data-no-translate>{formatCashReceiptIdentifier(row.identifier)}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">주문 상태</dt><dd className="font-semibold">{paid ? `결제완료 · ${order?.paid_at ? formatDateTime(order.paid_at) : ""}` : order?.status === "BANK_PENDING" ? "입금 대기" : order?.status ?? "-"}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">합계 / 공급가액 / 부가세</dt><dd className="font-semibold tabular-nums">{formatCurrency(amounts.totalKrw)}원 / {formatCurrency(amounts.supplyKrw)}원 / {formatCurrency(amounts.vatKrw)}원</dd></div>
                  <div><dt className="text-xs text-muted-foreground">입금자</dt><dd className="font-semibold" data-no-translate>{order?.depositor_name ?? "-"}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">신청</dt><dd className="font-semibold">{formatDateTime(row.requested_at)}</dd></div>
                  {row.approval_number && <div><dt className="text-xs text-muted-foreground">승인번호</dt><dd className="font-black tabular-nums">{row.approval_number}</dd></div>}
                  {row.issued_at && <div><dt className="text-xs text-muted-foreground">발급</dt><dd className="font-semibold">{formatDateTime(row.issued_at)} · {row.issue_method === "INICIS" ? "이니시스" : "홈택스 입력"}</dd></div>}
                  {row.cancel_reason && <div><dt className="text-xs text-muted-foreground">취소 사유</dt><dd className="font-semibold">{row.cancel_reason}</dd></div>}
                </dl>
                {row.failure_message && <p className="mt-3 rounded-[8px] border-2 border-[var(--bauhaus-red)] p-3 text-xs font-semibold leading-5">{row.failure_message}</p>}
                <div className="mt-4 flex flex-wrap items-end gap-3">
                  {submissionId && <Link href={`/admin/submissions/detail?id=${submissionId}`} className={`${buttonClass} bg-background text-foreground`}>접수 상세 (입금 확인)</Link>}
                  {row.approval_number && (row.status === "ISSUED" || row.status === "CANCELED") && (
                    <a href={`/api/admin/orders/${row.order_id}/cash-receipt`} className={`${buttonClass} bg-[var(--bauhaus-yellow)] text-[#111111]`}>PDF 다운로드</a>
                  )}
                  {issuable && autoIssue && (
                    <form action={issueCashReceiptAction}>
                      <input type="hidden" name="orderId" value={row.order_id} /><input type="hidden" name="filter" value={filter} />
                      <button className={`${buttonClass} bg-[var(--bauhaus-blue)] text-white`}>이니시스로 발급</button>
                    </form>
                  )}
                  {issuable && (
                    <form action={recordManualCashReceiptAction} className="flex flex-wrap items-end gap-2">
                      <input type="hidden" name="orderId" value={row.order_id} /><input type="hidden" name="filter" value={filter} />
                      <label className="grid gap-1 text-xs font-black">승인번호<input name="approvalNumber" required maxLength={40} className={inputClass} /></label>
                      <label className="grid gap-1 text-xs font-black">발급 일시(KST)<input type="datetime-local" name="issuedAt" required defaultValue={nowKstInput()} className={inputClass} /></label>
                      <button className={`${buttonClass} bg-background text-foreground`}>승인번호 저장</button>
                    </form>
                  )}
                  {verify && (
                    <form action={resolveUncertainCashReceiptAction} className="flex flex-wrap items-end gap-2">
                      <input type="hidden" name="orderId" value={row.order_id} /><input type="hidden" name="filter" value={filter} /><input type="hidden" name="outcome" value="ISSUED" />
                      <label className="grid gap-1 text-xs font-black">이니시스 승인번호<input name="approvalNumber" required maxLength={40} className={inputClass} /></label>
                      <label className="grid gap-1 text-xs font-black">발급 일시(KST)<input type="datetime-local" name="issuedAt" required defaultValue={nowKstInput()} className={inputClass} /></label>
                      <button className={`${buttonClass} bg-[var(--bauhaus-blue)] text-white`}>발급됨으로 기록</button>
                    </form>
                  )}
                  {verify && (
                    <form action={resolveUncertainCashReceiptAction} className="flex flex-wrap items-end gap-2">
                      <input type="hidden" name="orderId" value={row.order_id} /><input type="hidden" name="filter" value={filter} /><input type="hidden" name="outcome" value="NOT_ISSUED" />
                      <label className="grid gap-1 text-xs font-black">확인 내용<input name="note" required maxLength={300} placeholder="예: 이니시스 발행 내역에 없음" className={inputClass} /></label>
                      <button className={`${buttonClass} bg-background text-[var(--bauhaus-red)]`}>미발급으로 기록</button>
                    </form>
                  )}
                  {(row.status === "REQUESTED" || row.status === "FAILED" || row.status === "ISSUED") && (
                    <form action={cancelCashReceiptAction} className="flex flex-wrap items-end gap-2">
                      <input type="hidden" name="orderId" value={row.order_id} /><input type="hidden" name="filter" value={filter} />
                      <label className="grid gap-1 text-xs font-black">취소 사유<input name="reason" required maxLength={300} placeholder={row.status === "ISSUED" ? "홈택스·이니시스에서 먼저 취소" : "예: 번호 오류"} className={inputClass} /></label>
                      <button className={`${buttonClass} bg-background text-[var(--bauhaus-red)]`}>취소 처리</button>
                    </form>
                  )}
                </div>
                {order?.status === "BANK_PENDING" && (row.status === "REQUESTED" || row.status === "FAILED") && <p className="mt-3 text-xs leading-5 text-muted-foreground">입금이 확인되면 접수 상세에서 결제완료로 바꿔주세요. {autoIssue ? "그때 자동으로 발급합니다." : "그 후 이곳에서 발급 정보를 입력합니다."}</p>}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
