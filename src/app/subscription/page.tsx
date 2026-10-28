import { redirect } from "next/navigation";
import Link from "next/link";

import { createServerSupabase } from "@/lib/supabase/server";
import { formatCurrency } from "@/lib/format";
import {
  buildMobileBillingRequest,
  buildStdPayRequest,
  resolveSubscriptionPrice,
} from "@/lib/inicis/stdpay";
import { getBillingConfig, getStdPayConfig } from "@/lib/inicis/config";
import { buildUrl, getBaseUrl } from "@/lib/url";
import {
  createHistoryAttempt,
  getActiveSubscription,
} from "@/lib/subscriptions/service";
import { SubscriptionPayButtons } from "@/features/subscriptions/subscription-pay";

const maskMid = (mid: string) => {
  if (!mid) return "";
  return mid.length <= 4
    ? `${mid.slice(0, 2)}**`
    : `${mid.slice(0, 2)}***${mid.slice(-2)}`;
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
  const buyerEmail = user.email?.trim();

  if (!subscription && !buyerEmail) {
    return (
      <div className="mx-auto w-full max-w-3xl px-6 py-12">
        <p className="bauhaus-kicker">Subscription</p>
        <h1 className="font-display mt-4 text-2xl font-black text-foreground">
          정기결제 안내를 받을 이메일이 필요합니다.
        </h1>
        <p className="mt-4 text-sm font-semibold leading-6 text-muted-foreground">
          현재 계정에는 이메일이 등록되어 있지 않습니다. 이메일이 등록된 계정으로
          로그인하거나 고객센터에 문의해주세요.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/login?next=%2Fsubscription" className="bauhaus-button min-h-11 px-4 py-3 text-sm">
            다른 계정으로 로그인
          </Link>
          <Link href="/support" className="inline-flex min-h-11 items-center rounded-[8px] border-2 border-border bg-background px-4 py-3 text-sm font-bold focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#1556a4]">
            고객센터
          </Link>
        </div>
      </div>
    );
  }

  const amountKrw = resolveSubscriptionPrice();

  if (!amountKrw || amountKrw <= 0) {
    return (
      <div className="mx-auto w-full max-w-3xl px-6 py-12">
        <p className="bauhaus-kicker">
          Subscription
        </p>
        <h1 className="font-display mt-4 text-2xl font-black text-foreground">
          정기결제 금액이 설정되지 않았습니다.
        </h1>
        <p className="mt-4 text-sm font-semibold text-muted-foreground">
          환경변수 SUBSCRIPTION_PRICE_KRW 값을 설정한 후 다시 시도해주세요.
        </p>
      </div>
    );
  }

  let config: ReturnType<typeof getStdPayConfig> | null = null;
  let configError: string | null = null;
  try {
    config = getStdPayConfig();
    const billingConfig = getBillingConfig();
    if (billingConfig.mid !== config.mid) {
      throw new Error("이니시스 일반결제 MID와 빌링 MID가 일치하지 않습니다.");
    }
  } catch (error) {
    configError =
      error instanceof Error
        ? error.message
        : "이니시스 설정을 불러올 수 없습니다.";
  }

  if (!config || configError) {
    return (
      <div className="mx-auto w-full max-w-3xl px-6 py-12">
        <p className="bauhaus-kicker">
          Subscription
        </p>
        <h1 className="font-display mt-4 text-2xl font-black text-foreground">
          결제 설정을 확인할 수 없습니다.
        </h1>
        <p className="mt-4 text-sm font-semibold text-muted-foreground">
          {configError ?? "이니시스 결제 설정을 다시 확인해주세요."}
        </p>
      </div>
    );
  }

  const baseUrl = getBaseUrl();
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

    if (
      orderCreate.error ||
      !orderCreate.orderId ||
      !orderCreate.callbackState
    ) {
      return (
        <div className="mx-auto w-full max-w-3xl px-6 py-12">
          <p className="bauhaus-kicker">
            Subscription
          </p>
          <h1 className="font-display mt-4 text-2xl font-black text-foreground">
            결제 준비 중 오류가 발생했습니다.
          </h1>
          <p className="mt-4 text-sm font-semibold text-muted-foreground">
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
      buyerName: buyerEmail ?? "회원",
      buyerEmail,
      buyerTel: "",
      returnUrl,
      closeUrl: buildUrl(
        `/subscription/result?orderId=${encodeURIComponent(orderId)}`,
        baseUrl,
      ),
      billing: {
        callbackState: orderCreate.callbackState,
        offerPeriod: "M2",
      },
    });

    mobileParams = buildMobileBillingRequest({
      orderId,
      amountKrw,
      productName,
      buyerName: buyerEmail ?? "회원",
      buyerEmail,
      returnUrl: mobileReturnUrl,
      buyerTel: "",
      callbackState: orderCreate.callbackState,
      period: "M2",
    });
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <p className="bauhaus-kicker">
        Subscription
      </p>
      <h1 className="mt-4 text-2xl font-black text-foreground">
        정기결제
      </h1>
      <p className="mt-2 text-sm font-semibold text-muted-foreground">
        KG이니시스 정기결제(카드 빌링)으로 구독을 시작합니다. 결제창이
        열리지 않으면 팝업 차단 여부를 확인해주세요.
      </p>

      {subscription ? (
        <div className="mt-6 rounded-[8px] border-2 border-[#1f7a5a] bg-[#1f7a5a]/10 p-4 text-sm font-semibold text-[#1f7a5a]">
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
        <p>결제 MID: {maskMid(config.mid)}</p>
        <p>콜백 URL: {returnUrl}</p>
        <p>모바일 콜백 URL: {mobileReturnUrl}</p>
      </div>
    </div>
  );
}
