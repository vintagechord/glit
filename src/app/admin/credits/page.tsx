import Link from "next/link";

import { AdminSaveToast } from "@/components/admin/save-toast";
import {
  updateCreditRedemptionStatusFormAction,
  upsertCreditRewardFormAction,
} from "@/features/credits/actions";
import type {
  CreditReward,
  CreditRewardRedemption,
} from "@/lib/credits";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata = {
  title: "크레딧/쿠폰 관리",
};

export const dynamic = "force-dynamic";

type ProfileRow = {
  user_id: string;
  name: string | null;
  company: string | null;
  phone: string | null;
};

const statusOptions = [
  { value: "ISSUED", label: "발행됨" },
  { value: "USED", label: "사용 완료" },
  { value: "CANCELED", label: "취소" },
] as const;

const statusLabels: Record<string, string> = {
  ISSUED: "발행됨",
  USED: "사용 완료",
  CANCELED: "취소",
};

const formatDate = (value?: string | null) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(date);
};

const fieldClass =
  "h-10 w-full rounded-2xl border border-border/70 bg-background px-3 text-xs text-foreground";

const labelClass = "space-y-1 text-xs font-semibold text-muted-foreground";

function RewardForm({
  reward,
  submitLabel,
}: {
  reward?: CreditReward;
  submitLabel: string;
}) {
  return (
    <form action={upsertCreditRewardFormAction} className="space-y-4">
      {reward ? <input type="hidden" name="id" value={reward.id} /> : null}
      <div className="grid gap-3 md:grid-cols-[1.4fr_140px_140px_100px_auto]">
        <label className={labelClass}>
          이용권명
          <input
            name="title"
            required
            defaultValue={reward?.title ?? ""}
            placeholder="예: 빈티지하우스 메인 녹음실 1시간 권"
            className={fieldClass}
          />
        </label>
        <label className={labelClass}>
          필요 크레딧
          <input
            name="creditsRequired"
            required
            type="number"
            min={1}
            defaultValue={reward?.credits_required ?? 1}
            className={fieldClass}
          />
        </label>
        <label className={labelClass}>
          유효일
          <input
            name="validityDays"
            type="number"
            min={1}
            defaultValue={reward?.validity_days ?? 90}
            className={fieldClass}
          />
        </label>
        <label className={labelClass}>
          정렬
          <input
            name="sortOrder"
            type="number"
            min={0}
            defaultValue={reward?.sort_order ?? 0}
            className={fieldClass}
          />
        </label>
        <label className="flex items-end gap-2 pb-2 text-xs font-semibold text-muted-foreground">
          <input
            type="checkbox"
            name="isActive"
            defaultChecked={reward?.is_active ?? true}
            className="h-4 w-4 rounded border-border"
          />
          노출
        </label>
      </div>
      <div className="grid gap-3 md:grid-cols-[1fr_1.6fr_auto]">
        <label className={labelClass}>
          장소/서비스
          <input
            name="serviceLocation"
            defaultValue={reward?.service_location ?? ""}
            placeholder="예: 빈티지하우스 메인 녹음실"
            className={fieldClass}
          />
        </label>
        <label className={labelClass}>
          설명
          <input
            name="description"
            defaultValue={reward?.description ?? ""}
            placeholder="사용자에게 보이는 이용권 설명"
            className={fieldClass}
          />
        </label>
        <div className="flex items-end">
          <button
            type="submit"
            className="h-10 rounded-full bg-foreground px-5 text-xs font-semibold uppercase tracking-[0.2em] text-background"
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </form>
  );
}

export default async function AdminCreditsPage({
  searchParams,
}: {
  searchParams?: Promise<{
    saved?: string | string[];
    error?: string | string[];
  }>;
}) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const savedFlag = Array.isArray(resolvedSearchParams?.saved)
    ? resolvedSearchParams?.saved[0]
    : resolvedSearchParams?.saved;
  const errorFlag = Array.isArray(resolvedSearchParams?.error)
    ? resolvedSearchParams?.error[0]
    : resolvedSearchParams?.error;

  const admin = createAdminClient();
  const [rewardsResult, redemptionsResult] = await Promise.all([
    admin
      .from("credit_rewards")
      .select(
        "id, title, description, credits_required, service_location, validity_days, sort_order, is_active, created_at",
      )
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false }),
    admin
      .from("credit_reward_redemptions")
      .select(
        "id, user_id, reward_id, reward_title, reward_description, credits_spent, coupon_code, status, expires_at, admin_memo, issued_at, used_at, canceled_at, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(120),
  ]);

  const rewards = (rewardsResult.data ?? []) as CreditReward[];
  const redemptions =
    (redemptionsResult.data ?? []) as CreditRewardRedemption[];
  const userIds = Array.from(
    new Set(redemptions.map((redemption) => redemption.user_id).filter(Boolean)),
  );
  const { data: profilesData } =
    userIds.length > 0
      ? await admin
          .from("profiles")
          .select("user_id, name, company, phone")
          .in("user_id", userIds)
      : { data: [] as ProfileRow[] };
  const profileMap = new Map(
    ((profilesData ?? []) as ProfileRow[]).map((profile) => [
      profile.user_id,
      profile,
    ]),
  );

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-12">
      {savedFlag ? <AdminSaveToast message="저장되었습니다." /> : null}
      <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
        관리자
      </p>
      <h1 className="font-display mt-2 text-3xl text-foreground">
        크레딧/쿠폰 관리
      </h1>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-3xl text-sm text-muted-foreground">
          음반심의 결제 크레딧으로 교환 가능한 서비스 이용권을 등록하고, 발행된
          쿠폰의 사용 상태를 관리합니다.
        </p>
        <Link
          href="/admin/credits/requests"
          className="rounded-full border border-border bg-background px-4 py-2 text-xs font-semibold text-foreground transition hover:border-foreground"
        >
          크레딧 요청 관리
        </Link>
      </div>

      {errorFlag ? (
        <div className="mt-6 rounded-2xl border border-dashed border-red-500/40 bg-red-500/10 px-4 py-3 text-xs text-red-600">
          저장 또는 상태 변경 중 오류가 발생했습니다. 입력값과 마이그레이션 적용
          상태를 확인해주세요.
        </div>
      ) : null}

      <div className="mt-8 space-y-6">
        <section className="space-y-4 rounded-[32px] border border-border/60 bg-card/80 p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-foreground">
                등록된 이용권
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                노출 체크를 끄면 사용자는 해당 이용권을 새로 교환할 수 없습니다.
              </p>
            </div>
            <span className="rounded-full border border-border bg-background px-3 py-1 text-xs font-semibold text-muted-foreground">
              {rewards.length.toLocaleString()}개
            </span>
          </div>
          <div className="space-y-4">
            {rewards.length > 0 ? (
              rewards.map((reward) => (
                <div
                  key={reward.id}
                  className="rounded-2xl border border-border/60 bg-background/70 p-4"
                >
                  <RewardForm reward={reward} submitLabel="저장" />
                </div>
              ))
            ) : (
              <div className="rounded-2xl border border-dashed border-border/60 bg-background/70 px-4 py-6 text-xs text-muted-foreground">
                등록된 이용권이 없습니다.
              </div>
            )}
          </div>
        </section>

        <section className="rounded-[32px] border border-border/60 bg-card/80 p-6">
          <h2 className="text-lg font-semibold text-foreground">
            새 이용권 등록
          </h2>
          <div className="mt-4">
            <RewardForm submitLabel="추가" />
          </div>
        </section>

        <section className="space-y-4 rounded-[32px] border border-border/60 bg-card/80 p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-foreground">
                발행된 쿠폰
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                사용 완료 처리 시 고객의 쿠폰 상태가 마이페이지에도 반영됩니다.
                취소 처리된 쿠폰은 크레딧 사용량에서 제외됩니다.
              </p>
            </div>
            <span className="rounded-full border border-border bg-background px-3 py-1 text-xs font-semibold text-muted-foreground">
              최근 {redemptions.length.toLocaleString()}건
            </span>
          </div>

          {redemptions.length > 0 ? (
            <div className="space-y-4">
              {redemptions.map((redemption) => {
                const profile = profileMap.get(redemption.user_id);
                return (
                  <div
                    key={redemption.id}
                    className="rounded-2xl border border-border/60 bg-background/70 p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <p className="text-base font-semibold text-foreground">
                          {redemption.reward_title}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {profile?.name || "회원명 미입력"}
                          {profile?.company ? ` · ${profile.company}` : ""}
                          {profile?.phone ? ` · ${profile.phone}` : ""}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {redemption.credits_spent}크레딧 · 발행{" "}
                          {formatDate(redemption.issued_at)} · 유효기간{" "}
                          {formatDate(redemption.expires_at)}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="rounded-[8px] border-2 border-[#111111] bg-[#111111] px-3 py-2 text-sm font-black text-white">
                          {redemption.coupon_code}
                        </p>
                        <p className="mt-2 text-[11px] font-semibold text-muted-foreground">
                          {statusLabels[redemption.status] ?? redemption.status}
                        </p>
                      </div>
                    </div>
                    <form
                      action={updateCreditRedemptionStatusFormAction}
                      className="mt-4 grid gap-3 md:grid-cols-[160px_1fr_auto]"
                    >
                      <input
                        type="hidden"
                        name="redemptionId"
                        value={redemption.id}
                      />
                      <input
                        type="hidden"
                        name="redirectTo"
                        value="/admin/credits"
                      />
                      <label className={labelClass}>
                        상태
                        <select
                          name="status"
                          defaultValue={redemption.status}
                          className={fieldClass}
                        >
                          {statusOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className={labelClass}>
                        관리자 메모
                        <input
                          name="adminMemo"
                          defaultValue={redemption.admin_memo ?? ""}
                          placeholder="예약일, 사용 확인 메모 등"
                          className={fieldClass}
                        />
                      </label>
                      <div className="flex items-end">
                        <button
                          type="submit"
                          className="h-10 rounded-full bg-foreground px-5 text-xs font-semibold uppercase tracking-[0.2em] text-background"
                        >
                          상태 저장
                        </button>
                      </div>
                    </form>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-border/60 bg-background/70 px-4 py-6 text-xs text-muted-foreground">
              아직 발행된 쿠폰이 없습니다.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
