import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { createServerSupabase } from "@/lib/supabase/server";
import { formatCurrency } from "@/lib/format";
import {
  buildMobileBillingRequest,
  buildStdPayRequest,
  resolveSubscriptionPrice,
} from "@/lib/inicis/stdpay";
import { getStdPayConfig } from "@/lib/inicis/config";
import { buildUrl } from "@/lib/url";
import {
  createHistoryAttempt,
  getActiveSubscription,
} from "@/lib/subscriptions/service";
import { SubscriptionPayButtons } from "@/features/subscriptions/subscription-pay";

const resolveBaseUrl = async () => {
  const headerList = await headers();
  const proto = headerList.get("x-forwarded-proto") ?? "https";
  const host =
    headerList.get("x-forwarded-host") ??
    headerList.get("host") ??
    "localhost:3000";
  return `${proto}://${host}`.replace(/\/+$/, "");
};

export default async function SubscriptionPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/subscription");
  }

  const { subscription } = await getActiveSubscription(user.id);
  const amountKrw = resolveSubscriptionPrice();
  const config = getStdPayConfig();
  const baseUrl = await resolveBaseUrl();

  if (!amountKrw || amountKrw <= 0) {
    return (
      <div className="mx-auto w-full max-w-3xl px-6 py-12">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
          Subscription
        </p>
        <h1 className="font-display mt-2 text-2xl text-foreground">
          정기결제 금액이 설정되지 않았습니다.
        </h1>
        <p className="mt-4 text-sm text-muted-foreground">
          환경변수 SUBSCRIPTION_PRICE_KRW 값을 설정한 후 다시 시도해주세요.
        </p>
      </div>
    );
  }

  const productName = "온사이드 정기 구독";

  let stdParams:
    | ReturnType<typeof buildStdPayRequest>
    | null = null;
  let mobileParams:
    | ReturnType<typeof buildMobileBillingRequest>
    | null = null;
  let orderId: string | null = null;
  const returnUrl = buildUrl("/api/inicis/key-return", baseUrl);
  const mobileReturnUrl = buildUrl("/api/inicis/mobile-return", baseUrl);

  if (!subscription) {
    const orderCreate = await createHistoryAttempt({
      userId: user.id,
      amountKrw,
      productName,
    });

    if (orderCreate.error || !orderCreate.orderId) {
      return (
        <div className="mx-auto w-full max-w-3xl px-6 py-12">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
            Subscription
          </p>
          <h1 className="font-display mt-2 text-2xl text-foreground">
            결제 준비 중 오류가 발생했습니다.
          </h1>
          <p className="mt-4 text-sm text-muted-foreground">
            {orderCreate.error?.message ?? "잠시 후 다시 시도해주세요."}
          </p>
        </div>
      );
    }

    orderId = orderCreate.orderId;

    stdParams = buildStdPayRequest({
      orderId,
      amountKrw,
      productName,
      buyerName: user.email ?? "회원",
      buyerEmail: user.email ?? "",
      buyerTel: "",
      returnUrl,
      closeUrl: buildUrl(
        `/subscription/result?orderId=${encodeURIComponent(orderId)}`,
        baseUrl,
      ),
    });

    mobileParams = buildMobileBillingRequest({
      orderId,
      amountKrw,
      productName,
      buyerName: user.email ?? "회원",
      buyerEmail: user.email ?? "",
      returnUrl: mobileReturnUrl,
      buyerTel: "",
    });
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
        Subscription
      </p>
      <h1 className="mt-2 text-2xl font-semibold text-foreground">
        정기결제
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        KG이니시스 정기결제(카드 빌링)으로 구독을 시작합니다. 결제창이
        열리지 않으면 팝업 차단 여부를 확인해주세요.
      </p>

      {subscription ? (
        <div className="mt-6 rounded-2xl border border-emerald-400/50 bg-emerald-50/50 p-4 text-sm text-emerald-900">
          <p className="font-semibold">활성화된 구독이 있습니다.</p>
          <p className="mt-1">
            상태: {subscription.status} · 금액:{" "}
            {formatCurrency(subscription.amount_krw ?? amountKrw)}원
          </p>
        </div>
      ) : null}

      {!subscription && stdParams && mobileParams && orderId ? (
        <div className="mt-6">
          <SubscriptionPayButtons
            stdJsUrl={config.stdJsUrl}
            stdParams={stdParams}
            mobileParams={mobileParams}
            orderId={orderId}
            amountLabel={`${formatCurrency(amountKrw)}원`}
          />
        </div>
      ) : null}

      <div className="mt-6 text-xs text-muted-foreground">
        <p>테스트 MID: {config.mid}</p>
        <p>콜백 URL: {returnUrl}</p>
        <p>모바일 콜백 URL: {mobileReturnUrl}</p>
      </div>
    </div>
  );
}
