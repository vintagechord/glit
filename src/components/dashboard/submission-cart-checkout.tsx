"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Check,
  CreditCard,
  Eye,
  Landmark,
  Pencil,
  ShoppingCart,
  Trash2,
} from "lucide-react";
import * as React from "react";

import { APP_CONFIG } from "@/lib/config";
import { formatCurrency, formatDateTime } from "@/lib/format";
import {
  readGuestSubmissionCartEntries,
  removeGuestSubmissionCartEntries,
  toGuestTokensBySubmissionId,
} from "@/lib/guest-submission-cart";
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
  guestToken: string | null;
};

type PaymentMethod = "CARD" | "BANK";

const normalizePackageName = (item: SubmissionCartItem) => {
  const raw = item.package;
  if (Array.isArray(raw)) return raw[0]?.name ?? null;
  return raw?.name ?? null;
};

export const mapSubmissionCartItem = (
  item: SubmissionCartItem,
  guestToken: string | null = null,
): CartItem => ({
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
  guestToken,
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

const getGuestTokensForItems = (items: CartItem[]) =>
  Object.fromEntries(
    items
      .filter((item) => Boolean(item.guestToken))
      .map((item) => [item.id, item.guestToken as string]),
  );

const normalizeInicisStatus = (type: string) => {
  const rawStatus = type.replace("INICIS:", "").toUpperCase();
  if (rawStatus.startsWith("SUCCESS")) return "SUCCESS";
  if (rawStatus.startsWith("CANCEL")) return "CANCEL";
  if (rawStatus.startsWith("FAIL")) return "FAIL";
  if (rawStatus.startsWith("ERROR")) return "ERROR";
  return rawStatus;
};

export function SubmissionCartCheckout({
  userId,
  initialItems,
}: {
  userId: string | null;
  initialItems: SubmissionCartItem[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isEnglishRoute = pathname === "/en" || pathname.startsWith("/en/");
  const cartHref = isEnglishRoute ? "/en/mypage/cart" : "/mypage/cart";
  const newSubmissionHref = isEnglishRoute ? "/en/dashboard/new" : "/dashboard/new";
  const focusedSubmissionId =
    searchParams.get("focus") ?? searchParams.get("added");
  const [cartItems, setCartItems] = React.useState<CartItem[]>(() =>
    initialItems.map((item) => mapSubmissionCartItem(item)),
  );
  const [isLoadingGuestCart, setIsLoadingGuestCart] = React.useState(!userId);
  React.useEffect(() => {
    if (!userId) return;
    setCartItems(initialItems.map((item) => mapSubmissionCartItem(item)));
    setIsLoadingGuestCart(false);
  }, [initialItems, userId]);
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
  const [pendingDeleteIds, setPendingDeleteIds] = React.useState<string[] | null>(
    null,
  );
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
        message: userId
          ? "결제가 완료되었습니다. 결제된 신청서는 나의 심의 내역에서 확인할 수 있습니다."
          : "결제가 완료되었습니다. 비회원 조회 코드로 진행 상태를 확인할 수 있습니다.",
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
    if (userId) return;

    const controller = new AbortController();
    const loadGuestCart = async () => {
      const entries = readGuestSubmissionCartEntries();
      if (entries.length === 0) {
        setCartItems([]);
        setIsLoadingGuestCart(false);
        return;
      }

      try {
        const guestTokensBySubmissionId =
          toGuestTokensBySubmissionId(entries);
        const response = await fetch("/api/cart/items", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ guestTokensBySubmissionId }),
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = (await response.json().catch(() => ({}))) as {
          items?: SubmissionCartItem[];
          invalidSubmissionIds?: string[];
          error?: string;
        };
        if (!response.ok) {
          throw new Error(payload.error ?? "장바구니 항목을 불러오지 못했습니다.");
        }

        const nextItems = (payload.items ?? []).map((item) =>
          mapSubmissionCartItem(
            item,
            guestTokensBySubmissionId[item.id] ?? null,
          ),
        );
        if (!controller.signal.aborted) {
          setCartItems(nextItems);
          const invalidIds = payload.invalidSubmissionIds ?? [];
          if (invalidIds.length > 0) {
            removeGuestSubmissionCartEntries(invalidIds);
          }
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setNotice({
            type: "error",
            message:
              error instanceof Error
                ? error.message
                : "장바구니 항목을 불러오지 못했습니다.",
          });
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoadingGuestCart(false);
        }
      }
    };

    void loadGuestCart();
    return () => controller.abort();
  }, [userId]);

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

  React.useEffect(() => {
    if (!focusedSubmissionId) return;
    const target = items.find((item) => item.id === focusedSubmissionId);
    if (!target || getPayableAmount(target) <= 0) return;

    setSelectedIds((prev) => {
      if (prev.has(focusedSubmissionId)) return prev;
      const next = new Set(prev);
      next.add(focusedSubmissionId);
      return next;
    });

    window.requestAnimationFrame(() => {
      document
        .getElementById(`cart-item-${focusedSubmissionId}`)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }, [focusedSubmissionId, items]);

  const selectedItems = React.useMemo(
    () => items.filter((item) => selectedIds.has(item.id)),
    [items, selectedIds],
  );
  const selectedItemsRef = React.useRef(selectedItems);
  React.useEffect(() => {
    selectedItemsRef.current = selectedItems;
  }, [selectedItems]);
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
        if (!userId) {
          removeGuestSubmissionCartEntries(
            selectedItemsRef.current.map((item) => item.id),
          );
        }
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
  }, [cartHref, router, userId]);

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

  const getEditHref = (item: CartItem) =>
    item.type === "ALBUM" ? "/dashboard/new/album?from=drafts" : "/dashboard/new/mv?from=drafts";

  const getDetailHref = (item: CartItem) =>
    item.guestToken
      ? `/track/${encodeURIComponent(item.guestToken)}`
      : `/dashboard/submissions/${item.id}`;

  const prepareEditStorage = (item: CartItem) => {
    if (typeof window === "undefined") return;
    try {
      if (item.type === "ALBUM") {
        window.localStorage.setItem(
          `onside:draft:album:${userId ?? "guest"}`,
          JSON.stringify({
            ids: [item.id],
            guestToken: item.guestToken,
            updatedAt: Date.now(),
          }),
        );
        return;
      }

      window.localStorage.setItem(
        `onside:draft:mv:${userId ?? "guest"}`,
        JSON.stringify({
          id: item.id,
          guestToken: item.guestToken,
          mvType:
            item.type === "MV_BROADCAST"
              ? "MV_BROADCAST"
              : "MV_DISTRIBUTION",
          updatedAt: Date.now(),
        }),
      );
    } catch {
      // localStorage may be unavailable in private browsing modes.
    }
  };

  const handleDeleteItems = (ids: string[]) => {
    if (isDeleting || isOpening) return;
    const targetIds = Array.from(new Set(ids.filter(Boolean)));
    if (targetIds.length === 0) {
      setNotice({ type: "error", message: "삭제할 장바구니 항목을 선택해주세요." });
      return;
    }
    setPendingDeleteIds(targetIds);
  };

  const confirmDeleteItems = async (targetIds: string[]) => {
    setIsDeleting(true);
    setNotice(null);
    try {
      const response = await fetch("/api/cart/items", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          submissionIds: targetIds,
          guestTokensBySubmissionId: getGuestTokensForItems(
            items.filter((item) => targetIds.includes(item.id)),
          ),
        }),
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
      if (!userId) {
        removeGuestSubmissionCartEntries(Array.from(deletedIds));
      }
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
        guestTokensBySubmissionId: getGuestTokensForItems(selectedItems),
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
      guestToken: primaryItem.guestToken ?? undefined,
      guestTokensBySubmissionId: getGuestTokensForItems(selectedItems),
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

  if (isLoadingGuestCart) {
    return (
      <div className="rounded-[8px] border-2 border-dashed border-[var(--bauhaus-ink)] bg-[var(--background)] px-5 py-8 text-sm font-semibold text-muted-foreground">
        장바구니를 불러오는 중입니다...
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="space-y-5">
        {notice ? (
          <NoticeDialog
            type={notice.type}
            message={notice.message}
            onClose={() => setNotice(null)}
          />
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
      {notice ? (
        <NoticeDialog
          type={notice.type}
          message={notice.message}
          onClose={() => setNotice(null)}
        />
      ) : null}
      {pendingDeleteIds ? (
        <ConfirmDialog
          message={
            pendingDeleteIds.length === 1
              ? "이 장바구니 항목을 삭제할까요? 연결된 접수 현황도 함께 삭제되며 복구할 수 없습니다."
              : `선택한 ${pendingDeleteIds.length}개 장바구니 항목을 삭제할까요? 연결된 접수 현황도 함께 삭제되며 복구할 수 없습니다.`
          }
          onCancel={() => setPendingDeleteIds(null)}
          onConfirm={() => {
            const targetIds = pendingDeleteIds;
            setPendingDeleteIds(null);
            void confirmDeleteItems(targetIds);
          }}
        />
      ) : null}
      <div className="space-y-4">
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
                id={`cart-item-${item.id}`}
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
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Link
                    href={getDetailHref(item)}
                    className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[8px] border-2 border-[var(--bauhaus-ink)] bg-[var(--background)] px-3 text-[11px] font-black text-[var(--foreground)] shadow-[2px_2px_0_var(--bauhaus-shadow)] transition hover:-translate-y-0.5 hover:bg-[var(--bauhaus-yellow)] hover:text-[#111111]"
                    aria-label={`${getDisplayTitle(item)} 확인`}
                  >
                    <Eye size={14} strokeWidth={2.8} />
                    확인
                  </Link>
                  <Link
                    href={getEditHref(item)}
                    onClick={() => prepareEditStorage(item)}
                    className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[8px] border-2 border-[var(--bauhaus-ink)] bg-[var(--foreground)] px-3 text-[11px] font-black text-[var(--background)] shadow-[2px_2px_0_var(--bauhaus-shadow)] transition hover:-translate-y-0.5 hover:bg-[var(--bauhaus-yellow)] hover:text-[#111111]"
                    aria-label={`${getDisplayTitle(item)} 수정`}
                  >
                    <Pencil size={14} strokeWidth={2.8} />
                    수정
                  </Link>
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

function NoticeDialog({
  type,
  message,
  onClose,
}: {
  type: "info" | "error" | "success";
  message: string;
  onClose: () => void;
}) {
  const tone =
    type === "error"
      ? "border-[#d9362c] bg-[#fff6f5] text-[#d9362c]"
      : type === "success"
        ? "border-[#1f7a5a] bg-[#f3fbf7] text-[#1f7a5a]"
        : "border-[#1556a4] bg-[#f5f9ff] text-[#1556a4]";
  const title =
    type === "error" ? "확인이 필요합니다." : type === "success" ? "완료되었습니다." : "안내";

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 px-4 py-6"
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        className={`w-full max-w-sm rounded-[10px] border-2 p-5 text-center shadow-[6px_6px_0_#111111] ${tone}`}
      >
        <p className="text-base font-black">{title}</p>
        <p className="mt-3 whitespace-pre-line text-sm font-semibold leading-6">
          {message}
        </p>
        <button
          type="button"
          onClick={onClose}
          className="mt-5 inline-flex h-10 min-w-28 items-center justify-center rounded-[8px] border-2 border-[#111111] bg-[#111111] px-5 text-xs font-black text-white shadow-[2px_2px_0_#1556a4] transition hover:-translate-y-0.5 hover:bg-[#1556a4]"
        >
          확인
        </button>
      </div>
    </div>
  );
}

function ConfirmDialog({
  message,
  onCancel,
  onConfirm,
}: {
  message: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/45 px-4 py-6"
      role="presentation"
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="cart-delete-dialog-title"
        aria-describedby="cart-delete-dialog-description"
        className="w-full max-w-sm rounded-[10px] border-2 border-[#111111] bg-[#fffaf0] p-5 text-center text-[#111111] shadow-[6px_6px_0_#111111] dark:border-[#f2cf27] dark:bg-[#171717] dark:text-white dark:shadow-[6px_6px_0_#f2cf27]"
      >
        <p id="cart-delete-dialog-title" className="text-base font-black">
          삭제 확인
        </p>
        <p
          id="cart-delete-dialog-description"
          className="mt-3 whitespace-pre-line text-sm font-semibold leading-6"
        >
          {message}
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex h-10 min-w-24 items-center justify-center rounded-[8px] border-2 border-[#111111] bg-white px-4 text-xs font-black text-[#111111] transition hover:-translate-y-0.5"
          >
            취소
          </button>
          <button
            type="button"
            onClick={onConfirm}
            autoFocus
            className="inline-flex h-10 min-w-24 items-center justify-center rounded-[8px] border-2 border-[#111111] bg-[var(--bauhaus-red)] px-4 text-xs font-black text-white shadow-[2px_2px_0_#111111] transition hover:-translate-y-0.5 dark:text-[#06111f]"
          >
            삭제
          </button>
        </div>
      </div>
    </div>
  );
}
