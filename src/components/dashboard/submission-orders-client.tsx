"use client";

import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowUpRight, Landmark, RefreshCw, ShoppingCart } from "lucide-react";
import * as React from "react";
import { CommerceConfirmDialog } from "./commerce-confirm-dialog";
import { APP_CONFIG } from "@/lib/config";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  addGuestSubmissionCartEntries, readGuestSubmissionOrderEntries,
  SUBMISSION_CART_UPDATED_EVENT, SUBMISSION_ORDERS_UPDATED_EVENT, toGuestTokensBySubmissionId,
} from "@/lib/guest-submission-cart";
import type { SubmissionOrder, SubmissionOrderItem, SubmissionOrderStatus, SubmissionOrdersPage } from "@/lib/submission-orders-types";

const statusLabels: Record<SubmissionOrderStatus, string> = {
  BANK_PENDING: "입금 대기", CARD_PENDING: "결제 확인 대기", PAYPAL_PENDING: "결제 확인 대기",
  PAID: "결제 완료", FAILED: "결제 실패", CANCELED: "주문 취소", REFUNDED: "환불 완료", REVIEW_REQUIRED: "확인 필요",
};
const filters = [
  { id: "all", label: "전체", statuses: [] },
  { id: "waiting", label: "대기", statuses: ["BANK_PENDING", "CARD_PENDING", "PAYPAL_PENDING", "REVIEW_REQUIRED"] },
  { id: "completed", label: "완료", statuses: ["PAID"] },
  { id: "closed", label: "실패·취소", statuses: ["FAILED", "CANCELED", "REFUNDED"] },
] as const;
type FilterId = typeof filters[number]["id"];
const panelClass = "rounded-[10px] border-2 border-[var(--bauhaus-ink)] bg-card p-4 shadow-[4px_4px_0_var(--bauhaus-shadow)] sm:p-5";
const buttonClass = "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-[8px] border-2 border-[var(--bauhaus-ink)] bg-background px-3 py-2 text-xs font-black text-foreground transition hover:-translate-y-0.5 disabled:cursor-wait disabled:opacity-50";
const orderTone = (status: SubmissionOrderStatus) => status === "PAID"
  ? "border-emerald-600 bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
  : ["FAILED", "CANCELED", "REFUNDED"].includes(status)
    ? "border-border bg-muted text-muted-foreground"
    : "border-[var(--bauhaus-ink)] bg-[var(--bauhaus-yellow)] text-[#111111]";
const displayItemTitle = (item: SubmissionOrderItem) => item.title?.trim()
  || (item.isOneclick ? "발매된 음반 · URL 접수" : "제목 미입력");
const displayAmount = (amountKrw: number | null, amount: number | null, currency: string) => {
  const value = currency === "KRW" ? amountKrw ?? amount : amount;
  if (value === null || !Number.isFinite(value)) return "금액 확인 필요";
  return currency === "KRW" ? `${formatCurrency(value)}원` : `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value)} ${currency}`;
};
const mergeOrders = (previous: SubmissionOrder[], incoming: SubmissionOrder[]) =>
  [...new Map([...previous, ...incoming].map((order) => [order.id, order])).values()]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

export function SubmissionOrdersClient({ userId }: { userId: string | null }) {
  const router = useRouter(); const pathname = usePathname(); const params = useSearchParams();
  const prefix = pathname === "/en" || pathname.startsWith("/en/") ? "/en" : "";
  const cartHref = `${prefix}/mypage/cart`;
  const focus = params.get("focus");
  const [orders, setOrders] = React.useState<SubmissionOrder[]>([]);
  const [nextOffset, setNextOffset] = React.useState<number | null>(null);
  const [filter, setFilter] = React.useState<FilterId>("all");
  const [loading, setLoading] = React.useState(true);
  const [loaded, setLoaded] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [returnOrder, setReturnOrder] = React.useState<SubmissionOrder | null>(null);
  const [returningId, setReturningId] = React.useState<string | null>(null);
  const requestSequence = React.useRef(0);
  const activeRequest = React.useRef<AbortController | null>(null);
  const focusedId = React.useRef<string | null>(null);
  const guestEntries = readGuestSubmissionOrderEntries();
  const guestTokens = toGuestTokensBySubmissionId(guestEntries);

  const loadOrders = React.useCallback(async (offset = 0, append = false) => {
    if (append && activeRequest.current) return;
    const sequence = ++requestSequence.current;
    activeRequest.current?.abort();
    const controller = new AbortController(); activeRequest.current = controller;
    setLoading(true); setError(null);
    try {
      const entries = readGuestSubmissionOrderEntries();
      if (!userId && entries.length === 0) { setOrders([]); setNextOffset(null); return; }
      const response = await fetchWithTimeout(userId ? `/api/orders?offset=${offset}` : "/api/orders", {
        method: userId ? "GET" : "POST", cache: "no-store", signal: controller.signal,
        ...(userId ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ guestTokensBySubmissionId: toGuestTokensBySubmissionId(entries), offset }) }),
      });
      const payload = (await response.json().catch(() => ({}))) as Partial<SubmissionOrdersPage> & { error?: string };
      if (!response.ok || !Array.isArray(payload.orders)) throw new Error(payload.error ?? "주문내역을 불러오지 못했습니다. 다시 시도해주세요.");
      if (sequence !== requestSequence.current) return;
      setOrders((previous) => append ? mergeOrders(previous, payload.orders!) : payload.orders!);
      setNextOffset((previous) => append && offset === 0 ? previous : payload.nextOffset ?? null);
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "주문내역을 불러오지 못했습니다. 다시 시도해주세요.");
    } finally {
      if (sequence === requestSequence.current) {
        activeRequest.current = null;
        if (!controller.signal.aborted) { setLoading(false); setLoaded(true); }
      }
    }
  }, [userId]);

  React.useEffect(() => {
    setOrders([]); setLoaded(false); focusedId.current = null;
    void loadOrders();
    const refresh = () => { void loadOrders(0, true); };
    window.addEventListener(SUBMISSION_ORDERS_UPDATED_EVENT, refresh);
    window.addEventListener("focus", refresh);
    return () => { activeRequest.current?.abort(); window.removeEventListener(SUBMISSION_ORDERS_UPDATED_EVENT, refresh); window.removeEventListener("focus", refresh); };
  }, [loadOrders]);
  const hasPendingOrder = orders.some((order) => ["BANK_PENDING", "CARD_PENDING", "PAYPAL_PENDING"].includes(order.status));
  React.useEffect(() => {
    if (!hasPendingOrder || returningId) return;
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void loadOrders(0, true); }, 15000);
    return () => window.clearInterval(timer);
  }, [hasPendingOrder, loadOrders, returningId]);
  const focusedOrder = orders.find((order) => order.id === focus || order.items.some((item) => item.submissionId === focus || item.submissionRef === focus));
  React.useEffect(() => {
    if (!focusedOrder || focusedId.current === focusedOrder.id) return;
    focusedId.current = focusedOrder.id;
    requestAnimationFrame(() => document.getElementById(`order-${focusedOrder.id}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  }, [focusedOrder]);

  const returnToCart = async (order: SubmissionOrder) => {
    if (returningId) return;
    setReturningId(order.id); setError(null);
    try {
      const entries = readGuestSubmissionOrderEntries();
      const itemIds = new Set(order.items.map((item) => item.submissionId ?? item.submissionRef));
      const response = await fetchWithTimeout("/api/orders/return", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: order.id, guestTokensBySubmissionId: userId ? {} : toGuestTokensBySubmissionId(entries.filter((entry) => itemIds.has(entry.submissionId))) }),
      });
      const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; submissionIds?: string[]; error?: string };
      if (!response.ok || !payload.ok || !Array.isArray(payload.submissionIds) || payload.submissionIds.length === 0) throw new Error(payload.error ?? "주문을 장바구니로 돌리지 못했습니다. 다시 시도해주세요.");
      if (!userId) addGuestSubmissionCartEntries(entries.filter((entry) => payload.submissionIds!.includes(entry.submissionId)));
      window.dispatchEvent(new Event(SUBMISSION_CART_UPDATED_EVENT));
      window.dispatchEvent(new Event(SUBMISSION_ORDERS_UPDATED_EVENT));
      router.push(`${cartHref}?focus=${encodeURIComponent(payload.submissionIds[0])}`);
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "주문을 장바구니로 돌리지 못했습니다. 다시 시도해주세요.");
    } finally { setReturningId(null); }
  };
  const visibleOrders = orders.filter((order) => filter === "all" || (filters.find((entry) => entry.id === filter)!.statuses as readonly string[]).includes(order.status));
  const getDetailHref = (item: SubmissionOrderItem) => !item.submissionId ? null
    : userId ? `${prefix}/mypage/submissions/${item.submissionId}`
      : guestTokens[item.submissionId] ? `${prefix}/track/${encodeURIComponent(guestTokens[item.submissionId])}` : null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-xl text-sm leading-6 text-muted-foreground">카드 결제와 무통장 입금이 확인된 주문은 완료에 표시됩니다. 입금 확인 전에는 대기에서 확인하세요.</p>
        <div className="flex flex-wrap gap-2">
          <Link href={cartHref} className={buttonClass}><ShoppingCart size={15} aria-hidden />장바구니</Link>
          <button type="button" className={buttonClass} onClick={() => void loadOrders()} disabled={loading || Boolean(returningId)}><RefreshCw size={15} className={loading ? "animate-spin" : ""} aria-hidden />새로고침</button>
        </div>
      </div>
      <nav aria-label="주문 상태" className="flex flex-wrap gap-2">
        {filters.map((entry) => <button key={entry.id} type="button" onClick={() => setFilter(entry.id)} aria-pressed={filter === entry.id}
          className={cn(buttonClass, filter === entry.id && "bg-[var(--bauhaus-yellow)] text-[#111111]")}>{entry.label}</button>)}
      </nav>
      {error && <div role="alert" className="rounded-[8px] border-2 border-red-600 bg-red-50 p-4 text-sm leading-6 text-red-800 dark:bg-red-950 dark:text-red-200">{error}</div>}
      {!loaded && loading ? <div className={panelClass}>주문내역을 불러오는 중입니다...</div> : visibleOrders.length === 0 ? (
        <div className={`${panelClass} space-y-3`}>
          <p className="text-sm text-muted-foreground">{orders.length === 0 ? "주문 내역이 없습니다." : "해당 상태의 주문이 없습니다."}</p>
          {!userId && <Link href={`${prefix}/track?mode=guest`} className={buttonClass}>비회원 조회 코드로 확인</Link>}
          {nextOffset !== null && <p className="text-xs text-muted-foreground">이전 주문을 더 불러와 확인할 수 있습니다.</p>}
        </div>
      ) : (
        <div className="space-y-4">
          {visibleOrders.map((order) => <article key={order.id} id={`order-${order.id}`} aria-label={`주문 ${order.id}`} tabIndex={-1}
            className={`${panelClass} ${focusedOrder?.id === order.id ? "ring-2 ring-[#1556a4] ring-offset-2 ring-offset-background" : ""}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-black text-muted-foreground">주문 번호</p>
                <p className="mt-1 break-all font-mono text-xs font-semibold">{order.id}</p>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">{formatDateTime(order.createdAt)} · {order.paymentMethod === "BANK" ? "무통장 입금" : order.paymentMethod === "PAYPAL" ? "PayPal" : "카드 결제"}</p>
              </div>
              <span className={`inline-flex rounded-[6px] border-2 px-2.5 py-1 text-xs font-black ${orderTone(order.status)}`}>{statusLabels[order.status]}</span>
            </div>
            <ul className="mt-4 divide-y divide-border rounded-[8px] border-2 border-border bg-background/70">
              {order.items.map((item) => {
                const detailHref = getDetailHref(item);
                return <li key={item.id} className="grid gap-2 p-3 sm:flex sm:flex-wrap sm:items-center sm:justify-between sm:gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-black">{displayItemTitle(item)}</p>
                    <p className="mt-1 break-words text-xs leading-5 text-muted-foreground">{item.artistName || (item.isOneclick ? "앨범 링크 확인 대기" : "아티스트 미입력")} · {item.packageName || "패키지 미지정"}</p>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 sm:justify-end">
                    <span className="text-xs font-semibold">{displayAmount(item.amountKrw, item.amount, order.currency)}</span>
                    {detailHref && <Link href={detailHref} className={buttonClass}><ArrowUpRight size={14} aria-hidden />{order.status === "PAID" ? "심의 내역 보기" : "신청서 확인"}</Link>}
                  </div>
                </li>;
              })}
            </ul>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <div><p className="text-xs text-muted-foreground">주문 금액</p><p className="mt-1 text-xl font-black">{displayAmount(order.amountKrw, order.amount, order.currency)}</p></div>
              {order.canReturnToCart && <button type="button" disabled={Boolean(returningId)} onClick={() => setReturnOrder(order)} className={cn(buttonClass, "bg-foreground text-background")}><ArrowLeft size={15} aria-hidden />{returningId === order.id ? "변경 중" : "장바구니로 돌리기"}</button>}
            </div>
            {order.status === "BANK_PENDING" && <div className="mt-4 rounded-[8px] border-2 border-[#1556a4]/40 bg-[#1556a4]/5 p-4">
              <p className="flex items-center gap-2 text-xs font-black"><Landmark size={15} aria-hidden />입금 계좌</p>
              <dl className="mt-3 grid grid-cols-[52px_minmax(0,1fr)] gap-x-2 gap-y-1 text-xs leading-6">
                <dt className="text-muted-foreground">은행</dt><dd>{APP_CONFIG.bankName}</dd>
                <dt className="text-muted-foreground">계좌</dt><dd className="break-all font-semibold">{APP_CONFIG.bankAccount}</dd>
                <dt className="text-muted-foreground">예금주</dt><dd className="break-words">{APP_CONFIG.bankHolder}</dd>
                <dt className="text-muted-foreground">입금액</dt><dd className="font-black">{displayAmount(order.amountKrw, order.amount, order.currency)}</dd>
              </dl>
              <p className="mt-3 text-xs leading-5 text-muted-foreground">이미 입금했다면 입금 확인을 기다려주세요.</p>
            </div>}
            {order.note && <p className="mt-3 whitespace-pre-wrap break-words text-xs leading-6 text-muted-foreground">{order.note}</p>}
            {order.returnedAt && <p className="mt-3 text-xs leading-5 text-muted-foreground">장바구니로 돌린 주문입니다. 기존 주문 이력은 보관됩니다.</p>}
          </article>)}
        </div>
      )}
      {nextOffset !== null && <div className="flex justify-center"><button type="button" className={buttonClass} disabled={loading || Boolean(returningId)} onClick={() => void loadOrders(nextOffset, true)}>{loading ? "불러오는 중..." : "이전 주문 더 보기"}</button></div>}
      {returnOrder && <CommerceConfirmDialog title="장바구니로 돌리기" confirmLabel="장바구니로 돌리기" message={[
        "이 주문에 포함된 신청서를 모두 장바구니로 돌립니다. 기존 주문 이력은 남고 결제 수단을 다시 선택할 수 있습니다.",
        returnOrder.status === "BANK_PENDING" ? "아직 입금하지 않은 경우에만 진행해주세요. 이미 입금했다면 입금 확인을 기다려주세요." : null,
        ["CARD_PENDING", "PAYPAL_PENDING"].includes(returnOrder.status) ? "열려 있는 결제창을 먼저 닫아주세요. 진행 중인 결제 요청이 취소됩니다." : null,
      ].filter(Boolean).join("\n\n")} onCancel={() => setReturnOrder(null)} onConfirm={() => { const order = returnOrder; setReturnOrder(null); void returnToCart(order); }} />}
    </div>
  );
}
