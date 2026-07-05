"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Check, CreditCard, Landmark, ShoppingCart, Trash2 } from "lucide-react";
import * as React from "react";

import { APP_CONFIG } from "@/lib/config";
import { formatCurrency, formatDateTime } from "@/lib/format";
import {
  cleanupInicisPaymentLayer,
  openInicisCardPopup,
  type InicisPopupContext,
} from "@/lib/inicis/popup";
import type { SubmissionCartItem } from "@/lib/submission-cart";

type CartItem = {
  id: string;
  type: string;
  status: string;
  paymentStatus: string | null;
  title: string | null;
  artistName: string | null;
  amountKrw: number | null;
  isOneclick: boolean | null;
  updatedAt: string | null;
  packageName: string | null;
};

type PaymentMethod = "CARD" | "BANK";

const normalizePackageName = (item: SubmissionCartItem) => {
  const raw = item.package;
  if (Array.isArray(raw)) return raw[0]?.name ?? null;
  return raw?.name ?? null;
};

export const mapSubmissionCartItem = (item: SubmissionCartItem): CartItem => ({
  id: item.id,
  type: item.type,
  status: item.status,
  paymentStatus: item.payment_status,
  title: item.title,
  artistName: item.artist_name,
  amountKrw: item.amount_krw,
  isOneclick: item.is_oneclick ?? null,
  updatedAt: item.updated_at,
  packageName: normalizePackageName(item),
});

const getTypeLabel = (item: CartItem) => {
  if (item.type === "ALBUM") {
    return item.isOneclick ? "원클릭 음반 심의" : "음반 심의";
  }
  if (item.type === "MV_DISTRIBUTION") return "일반 뮤직비디오 심의";
  if (item.type === "MV_BROADCAST") return "방송용 뮤직비디오 심의";
  return "심의";
};

const getPaymentContext = (item: CartItem): InicisPopupContext =>
  item.type === "ALBUM" ? (item.isOneclick ? "oneclick" : "music") : "mv";

const getDisplayTitle = (item: CartItem) => {
  const artist = item.artistName?.trim() || "아티스트 미입력";
  const title = item.title?.trim() || "제목 미입력";
  return `${artist} - ${title}`;
};

const getPayableAmount = (item: CartItem) => {
  const amount = Math.round(Number(item.amountKrw ?? 0));
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
};

const normalizeInicisStatus = (type: string) => {
  const rawStatus = type.replace("INICIS:", "").toUpperCase();
  if (rawStatus.startsWith("SUCCESS")) return "SUCCESS";
  if (rawStatus.startsWith("CANCEL")) return "CANCEL";
  if (rawStatus.startsWith("FAIL")) return "FAIL";
  if (rawStatus.startsWith("ERROR")) return "ERROR";
  return rawStatus;
};

export function SubmissionCartCheckout({
  initialItems,
}: {
  initialItems: SubmissionCartItem[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isEnglishRoute = pathname === "/en" || pathname.startsWith("/en/");
  const cartHref = isEnglishRoute ? "/en/mypage/cart" : "/mypage/cart";
  const newSubmissionHref = isEnglishRoute ? "/en/dashboard/new" : "/dashboard/new";
  const [cartItems, setCartItems] = React.useState<CartItem[]>(() =>
    initialItems.map(mapSubmissionCartItem),
  );
  React.useEffect(() => {
    setCartItems(initialItems.map(mapSubmissionCartItem));
  }, [initialItems]);
  const items = cartItems;
  const payableIds = React.useMemo(
    () => items.filter((item) => getPayableAmount(item) > 0).map((item) => item.id),
    [items],
  );
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(
    () => new Set(payableIds),
  );
  const [selectedMethod, setSelectedMethod] =
    React.useState<PaymentMethod>("CARD");
  const [isOpening, setIsOpening] = React.useState(false);
  const [isDeleting, setIsDeleting] = React.useState(false);
  const [bankResult, setBankResult] = React.useState<{
    count: number;
    totalAmountKrw: number;
  } | null>(null);
  const [notice, setNotice] = React.useState<{
    type: "info" | "error" | "success";
    message: string;
  } | null>(() => {
    const payment = searchParams.get("payment");
    if (payment === "success") {
      return {
        type: "success",
        message: "결제가 완료되었습니다. 결제된 신청서는 나의 심의 내역에서 확인할 수 있습니다.",
      };
    }
    if (payment === "cancel") {
      return {
        type: "error",
        message: "결제가 취소되었습니다. 필요한 신청서를 다시 선택해 결제할 수 있습니다.",
      };
    }
    if (payment === "fail" || payment === "error") {
      return {
        type: "error",
        message: "결제가 완료되지 않았습니다. 신청서는 장바구니에 유지됩니다.",
      };
    }
    if (searchParams.get("added")) {
      return {
        type: "success",
        message: "신청서가 장바구니에 담겼습니다. 결제할 신청서를 선택해주세요.",
      };
    }
    return null;
  });

  React.useEffect(() => {
    setSelectedIds((prev) => {
      const next = new Set<string>();
      const validIds = new Set(payableIds);
      prev.forEach((id) => {
        if (validIds.has(id)) next.add(id);
      });
      if (next.size === 0) {
        payableIds.forEach((id) => next.add(id));
      }
      return next;
    });
  }, [payableIds]);

  const selectedItems = items.filter((item) => selectedIds.has(item.id));
  const selectedTotal = selectedItems.reduce(
    (sum, item) => sum + getPayableAmount(item),
    0,
  );
  const isAllSelected =
    payableIds.length > 0 && payableIds.every((id) => selectedIds.has(id));

  React.useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (typeof window === "undefined") return;
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (!data || typeof data !== "object") return;
      const type = (data as { type?: string }).type;
      const payload = (data as { payload?: Record<string, unknown> }).payload ?? {};
      if (!type || !String(type).startsWith("INICIS:")) return;

      const status = normalizeInicisStatus(String(type));
      cleanupInicisPaymentLayer();
      if (status === "SUCCESS") {
        router.push(`${cartHref}?payment=success`);
        router.refresh();
        return;
      }

      if (status === "FAIL" || status === "CANCEL" || status === "ERROR") {
        const message =
          typeof payload.message === "string"
            ? payload.message
            : status === "CANCEL"
              ? "결제가 취소되었습니다. 신청서는 장바구니에 유지됩니다."
              : "결제가 완료되지 않았습니다. 다시 시도해주세요.";
        setNotice({ type: "error", message });
        setIsOpening(false);
        router.refresh();
      }
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [cartHref, router]);

  const toggleItem = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelectedIds(() => {
      if (isAllSelected) return new Set<string>();
      return new Set(payableIds);
    });
  };

  const handleDeleteItems = async (ids: string[]) => {
    if (isDeleting || isOpening) return;
    const targetIds = Array.from(new Set(ids.filter(Boolean)));
    if (targetIds.length === 0) {
      setNotice({ type: "error", message: "삭제할 장바구니 항목을 선택해주세요." });
      return;
    }
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        targetIds.length === 1
          ? "이 장바구니 항목을 삭제할까요? 삭제한 신청서는 복구할 수 없습니다."
          : `선택한 ${targetIds.length}개 장바구니 항목을 삭제할까요? 삭제한 신청서는 복구할 수 없습니다.`,
      )
    ) {
      return;
    }

    setIsDeleting(true);
    setNotice(null);
    try {
      const response = await fetch("/api/cart/items", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submissionIds: targetIds }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        deletedIds?: string[];
      };
      if (!response.ok) {
        setNotice({
          type: "error",
          message: payload.error ?? "장바구니 항목 삭제에 실패했습니다.",
        });
        return;
      }

      const deletedIds = new Set(payload.deletedIds ?? targetIds);
      setCartItems((prev) => prev.filter((item) => !deletedIds.has(item.id)));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        deletedIds.forEach((id) => next.delete(id));
        return next;
      });
      setBankResult(null);
      setNotice({
        type: "success",
        message:
          deletedIds.size === 1
            ? "장바구니 항목이 삭제되었습니다."
            : `${deletedIds.size}개 장바구니 항목이 삭제되었습니다.`,
      });
      window.dispatchEvent(new Event("onside:cart-updated"));
      router.refresh();
    } catch {
      setNotice({ type: "error", message: "장바구니 항목 삭제 중 오류가 발생했습니다." });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleBankTransfer = async () => {
    const response = await fetch("/api/cart/bank", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        submissionIds: selectedItems.map((item) => item.id),
      }),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
      count?: number;
      totalAmountKrw?: number;
    };

    if (!response.ok) {
      throw new Error(
        payload.error ?? "무통장 입금 대기 상태로 변경하지 못했습니다.",
      );
    }

    const nextResult = {
      count: Math.max(0, Math.trunc(Number(payload.count ?? selectedItems.length))),
      totalAmountKrw: Math.max(
        0,
        Math.round(Number(payload.totalAmountKrw ?? selectedTotal)),
      ),
    };
    setBankResult(nextResult);
    setNotice({
      type: "success",
      message: "무통장 입금 대기 상태로 변경되었습니다. 아래 계좌로 총액을 입금해주세요.",
    });
    router.refresh();
  };

  const handleCheckout = async () => {
    if (isOpening) return;
    if (selectedItems.length === 0) {
      setNotice({ type: "error", message: "결제할 신청서를 선택해주세요." });
      return;
    }
    if (selectedTotal <= 0) {
      setNotice({ type: "error", message: "결제 금액을 확인할 수 없습니다." });
      return;
    }

    const primaryItem = selectedItems[0];
    if (!primaryItem) return;

    setIsOpening(true);
    setBankResult(null);
    setNotice({
      type: "info",
      message:
        selectedMethod === "BANK"
          ? "무통장 입금 대기 상태로 변경 중입니다."
          : "이니시스 결제 모듈을 준비 중입니다.",
    });

    if (selectedMethod === "BANK") {
      try {
        await handleBankTransfer();
      } catch (error) {
        setNotice({
          type: "error",
          message:
            error instanceof Error
              ? error.message
              : "무통장 입금 대기 상태로 변경하지 못했습니다.",
        });
      } finally {
        setIsOpening(false);
      }
      return;
    }

    const { ok, error } = await openInicisCardPopup({
      context: getPaymentContext(primaryItem),
      submissionId: primaryItem.id,
      submissionIds: selectedItems.map((item) => item.id),
    });

    if (!ok) {
      setNotice({
        type: "error",
        message:
          error || "결제 모듈을 실행하지 못했습니다. 잠시 후 다시 시도해주세요.",
      });
      setIsOpening(false);
      return;
    }

    setNotice({
      type: "info",
      message: "결제 모듈을 실행했습니다. 결제를 완료해주세요.",
    });
  };

  if (items.length === 0) {
    return (
      <div className="space-y-5">
        {notice ? (
          <NoticeBox type={notice.type} message={notice.message} />
        ) : null}
        <div className="rounded-[8px] border-2 border-dashed border-[var(--bauhaus-ink)] bg-[var(--background)] px-5 py-8 text-sm font-semibold text-muted-foreground">
          장바구니에 담긴 미결제 신청서가 없습니다.
        </div>
        <Link
          href={newSubmissionHref}
          className="inline-flex h-10 items-center justify-center rounded-[8px] border-2 border-[var(--bauhaus-ink)] bg-[var(--bauhaus-yellow)] px-4 text-xs font-black tracking-normal text-[#111111] shadow-[2px_2px_0_var(--bauhaus-shadow)] transition hover:-translate-y-0.5"
        >
          새 신청서 작성
        </Link>
      </div>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-4">
        {notice ? <NoticeBox type={notice.type} message={notice.message} /> : null}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex items-center gap-2 rounded-[8px] border-2 border-[var(--bauhaus-ink)] bg-[var(--background)] px-3 py-2 text-xs font-black text-foreground shadow-[2px_2px_0_var(--bauhaus-shadow)]">
            <ShoppingCart size={16} strokeWidth={2.5} />
            <span>{items.length}건 대기</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={toggleAll}
              disabled={payableIds.length === 0 || isDeleting}
              className="inline-flex h-9 items-center justify-center rounded-[8px] border-2 border-[var(--bauhaus-ink)] bg-[var(--background)] px-3 text-[11px] font-black tracking-normal text-[var(--foreground)] shadow-[2px_2px_0_var(--bauhaus-shadow)] transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
            >
              {isAllSelected ? "전체 해제" : "전체 선택"}
            </button>
            <button
              type="button"
              onClick={() => void handleDeleteItems(Array.from(selectedIds))}
              disabled={selectedIds.size === 0 || isDeleting || isOpening}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[8px] border-2 border-[var(--bauhaus-ink)] bg-[var(--bauhaus-red)] px-3 text-[11px] font-black tracking-normal text-white shadow-[2px_2px_0_var(--bauhaus-shadow)] transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:opacity-70 disabled:hover:translate-y-0 dark:text-[#06111f]"
            >
              <Trash2 size={14} strokeWidth={2.8} />
              {isDeleting ? "삭제 중" : "선택 삭제"}
            </button>
          </div>
        </div>

        <div className="space-y-3">
          {items.map((item) => {
            const amount = getPayableAmount(item);
            const selected = selectedIds.has(item.id);
            const disabled = amount <= 0;
            return (
              <div
                key={item.id}
                className={`grid gap-3 rounded-[8px] border-2 px-4 py-4 transition md:grid-cols-[32px_minmax(0,1fr)_auto_auto] md:items-center ${
                  selected
                    ? "border-[var(--bauhaus-ink)] bg-[#fff4bd] shadow-[4px_4px_0_var(--bauhaus-shadow)] dark:bg-[#f2cf27]/18"
                    : "border-border bg-[var(--card)] hover:border-[var(--bauhaus-ink)]"
                } ${disabled ? "opacity-60" : ""}`}
              >
                <button
                  type="button"
                  onClick={() => {
                    if (!disabled) toggleItem(item.id);
                  }}
                  disabled={disabled || isDeleting}
                  aria-pressed={selected}
                  aria-label={`${getDisplayTitle(item)} 선택`}
                  className={`flex h-7 w-7 items-center justify-center rounded-[6px] border-2 ${
                    selected
                      ? "border-[var(--bauhaus-ink)] bg-[var(--bauhaus-ink)] text-[var(--background)]"
                      : "border-[var(--bauhaus-ink)] bg-[var(--background)] text-transparent"
                  }`}
                >
                  <Check size={16} strokeWidth={3} />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!disabled) toggleItem(item.id);
                  }}
                  disabled={disabled || isDeleting}
                  className="min-w-0 text-left disabled:cursor-default"
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="rounded-[6px] border-2 border-[var(--bauhaus-ink)] bg-[var(--background)] px-2 py-1 text-[11px] font-black text-[var(--foreground)]">
                      {getTypeLabel(item)}
                    </span>
                    {item.paymentStatus === "PAYMENT_PENDING" ? (
                      <span className="rounded-[6px] border-2 border-[var(--bauhaus-ink)] bg-[var(--bauhaus-yellow)] px-2 py-1 text-[11px] font-black text-[#111111]">
                        결제 대기
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-2 block truncate text-sm font-black text-foreground">
                    {getDisplayTitle(item)}
                  </span>
                  <span className="mt-1 block text-xs font-semibold leading-5 text-muted-foreground">
                    {item.packageName ?? "패키지 미지정"} · 최근 수정{" "}
                    {formatDateTime(item.updatedAt)}
                  </span>
                </button>
                <span className="text-right text-base font-black text-foreground md:min-w-[112px]">
                  {amount > 0 ? `${formatCurrency(amount)}원` : "금액 확인 필요"}
                </span>
                <button
                  type="button"
                  onClick={() => void handleDeleteItems([item.id])}
                  disabled={isDeleting || isOpening}
                  className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[8px] border-2 border-[var(--bauhaus-ink)] bg-[var(--background)] px-3 text-[11px] font-black text-[var(--foreground)] shadow-[2px_2px_0_var(--bauhaus-shadow)] transition hover:-translate-y-0.5 hover:bg-[var(--bauhaus-red)] hover:text-white disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 dark:hover:text-[#06111f]"
                  aria-label={`${getDisplayTitle(item)} 삭제`}
                >
                  <Trash2 size={14} strokeWidth={2.8} />
                  삭제
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <aside className="h-fit rounded-[8px] border-2 border-[var(--bauhaus-ink)] bg-[var(--card)] p-5 shadow-[6px_6px_0_var(--bauhaus-shadow)]">
        <p className="text-xs font-black uppercase tracking-normal text-muted-foreground">
          결제 요약
        </p>
        <div className="mt-4 grid gap-2">
          <button
            type="button"
            onClick={() => setSelectedMethod("CARD")}
            className={`flex min-h-12 items-center gap-3 rounded-[8px] border-2 px-3 py-2 text-left text-xs font-black transition ${
              selectedMethod === "CARD"
                ? "border-[var(--bauhaus-ink)] bg-[var(--bauhaus-yellow)] text-[#111111]"
                : "border-border bg-[var(--background)] text-[var(--foreground)] hover:border-[var(--bauhaus-ink)]"
            }`}
          >
            <CreditCard size={17} strokeWidth={2.6} />
            <span>카드 결제</span>
          </button>
          <button
            type="button"
            onClick={() => setSelectedMethod("BANK")}
            className={`flex min-h-12 items-center gap-3 rounded-[8px] border-2 px-3 py-2 text-left text-xs font-black transition ${
              selectedMethod === "BANK"
                ? "border-[var(--bauhaus-ink)] bg-[var(--bauhaus-yellow)] text-[#111111]"
                : "border-border bg-[var(--background)] text-[var(--foreground)] hover:border-[var(--bauhaus-ink)]"
            }`}
          >
            <Landmark size={17} strokeWidth={2.6} />
            <span>무통장 입금</span>
          </button>
        </div>
        <div className="mt-4 space-y-3 text-sm font-semibold text-foreground">
          <div className="flex items-center justify-between gap-3">
            <span>선택한 신청서</span>
            <span>{selectedItems.length}건</span>
          </div>
          <div className="flex items-center justify-between gap-3 border-t-2 border-border pt-3">
            <span>총 결제 금액</span>
            <span className="text-xl font-black">
              {formatCurrency(selectedTotal)}원
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={handleCheckout}
          disabled={isOpening || selectedItems.length === 0 || selectedTotal <= 0}
          className="mt-5 inline-flex h-12 w-full items-center justify-center gap-2 rounded-[8px] border-2 border-[var(--bauhaus-ink)] bg-[var(--bauhaus-red)] px-4 text-sm font-black tracking-normal text-white shadow-[3px_3px_0_var(--bauhaus-shadow)] transition hover:-translate-y-0.5 hover:bg-[#b92d25] disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none disabled:hover:translate-y-0 dark:text-[#06111f] dark:hover:bg-[#ff7a72]"
        >
          {selectedMethod === "BANK" ? (
            <Landmark size={18} strokeWidth={2.6} />
          ) : (
            <CreditCard size={18} strokeWidth={2.6} />
          )}
          {isOpening
            ? "결제 준비 중"
            : selectedMethod === "BANK"
              ? "무통장 입금으로 선택"
              : "선택 결제하기"}
        </button>
        <p className="mt-3 text-xs font-semibold leading-5 text-muted-foreground">
          {selectedMethod === "BANK"
            ? "선택한 신청서를 한 번에 입금 대기 상태로 변경합니다."
            : "선택한 신청서를 KG이니시스 카드 결제로 한 번에 결제합니다."}
        </p>
        {selectedMethod === "BANK" || bankResult ? (
          <div className="mt-4 rounded-[8px] border-2 border-border bg-[var(--background)] p-3 text-xs font-semibold leading-5 text-foreground">
            <p className="font-black">무통장 입금 안내</p>
            <p className="mt-2">은행: {APP_CONFIG.bankName}</p>
            <p>계좌: {APP_CONFIG.bankAccount}</p>
            <p>예금주: {APP_CONFIG.bankHolder}</p>
            <p className="mt-2 text-[var(--bauhaus-red)]">
              입금 금액: {formatCurrency(bankResult?.totalAmountKrw ?? selectedTotal)}원
            </p>
          </div>
        ) : null}
      </aside>
    </div>
  );
}

function NoticeBox({
  type,
  message,
}: {
  type: "info" | "error" | "success";
  message: string;
}) {
  const tone =
    type === "error"
      ? "border-[#d9362c] bg-[#d9362c]/10 text-[#d9362c]"
      : type === "success"
        ? "border-[#1f7a5a] bg-[#1f7a5a]/10 text-[#1f7a5a]"
        : "border-primary/20 bg-primary/8 text-primary dark:border-[#2997ff]/30 dark:bg-[#2997ff]/12 dark:text-[#8bc3ff]";

  return (
    <div className={`rounded-[8px] border-2 px-4 py-3 text-sm font-semibold ${tone}`}>
      {message}
    </div>
  );
}
