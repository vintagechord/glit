import Link from "next/link";

import { AdminSaveToast } from "@/components/admin/save-toast";
import { upsertCreditRewardFormAction } from "@/features/credits/actions";
import type { CreditReward } from "@/lib/credits";
import { requireAdminPage } from "@/lib/admin/page-auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata = {
  title: "크레딧 서비스 관리",
};

export const dynamic = "force-dynamic";

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
      <div className="grid gap-3 md:grid-cols-[1.4fr_140px_100px_auto]">
        <label className={labelClass}>
          서비스명
          <input
            name="title"
            required
            defaultValue={reward?.title ?? ""}
            placeholder="예: 빈티지하우스 메인 녹음실 1시간"
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
            placeholder="사용자에게 보이는 서비스 설명"
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
  await requireAdminPage();
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const savedFlag = Array.isArray(resolvedSearchParams?.saved)
    ? resolvedSearchParams?.saved[0]
    : resolvedSearchParams?.saved;
  const errorFlag = Array.isArray(resolvedSearchParams?.error)
    ? resolvedSearchParams?.error[0]
    : resolvedSearchParams?.error;

  const admin = createAdminClient();
  const rewardsResult = await admin
    .from("credit_rewards")
    .select(
      "id, title, description, credits_required, service_location, validity_days, sort_order, is_active, created_at",
    )
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });
  const rewards = (rewardsResult.data ?? []) as CreditReward[];

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-12">
      {savedFlag ? <AdminSaveToast message="저장되었습니다." /> : null}
      <h1 className="font-display text-3xl text-foreground">
        크레딧 서비스 관리
      </h1>
      <div className="mt-4 flex justify-end">
        <Link
          href="/admin/credits/requests"
          className="rounded-full border border-border bg-background px-4 py-2 text-xs font-semibold text-foreground transition hover:border-foreground"
        >
          요청 보기
        </Link>
      </div>

      {errorFlag ? (
        <div className="mt-6 rounded-2xl border border-dashed border-red-500/40 bg-red-500/10 px-4 py-3 text-xs text-red-600">
          저장하지 못했습니다. 입력값을 확인해주세요.
        </div>
      ) : null}

      <div className="mt-8 space-y-6">
        <section className="space-y-4 rounded-[32px] border border-border/60 bg-card/80 p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-foreground">
                등록된 서비스
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                비노출 서비스는 신규 신청에서 제외됩니다.
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
                등록된 서비스가 없습니다.
              </div>
            )}
          </div>
        </section>

        <section className="rounded-[32px] border border-border/60 bg-card/80 p-6">
          <h2 className="text-lg font-semibold text-foreground">
            새 서비스 등록
          </h2>
          <div className="mt-4">
            <RewardForm submitLabel="추가" />
          </div>
        </section>

      </div>
    </div>
  );
}
