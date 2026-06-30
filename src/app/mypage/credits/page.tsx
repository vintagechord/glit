import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Coins,
  ExternalLink,
  Gift,
  History,
  Info,
  Newspaper,
  Ticket,
} from "lucide-react";

import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { redeemCreditRewardFormAction } from "@/features/credits/actions";
import {
  StudioReservationForm,
  type StudioReservationContactDefaults,
} from "@/features/credits/studio-reservation-form";
import {
  getCreditRewardStudioUrl,
  getUserCreditSummary,
  listActiveCreditRewards,
  type CreditReward,
  type CreditRewardRedemption,
  type StudioReservationRequest,
} from "@/lib/credits";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata = {
  title: "마이페이지 - 나의 크레딧",
};

export const dynamic = "force-dynamic";

type CreditSourceSubmission = {
  id: string;
  title: string | null;
  artist_name: string | null;
  release_date: string | null;
  created_at: string | null;
};

type ProfileRow = {
  name: string | null;
  phone: string | null;
};

type UserMagazineRequest = {
  id: string;
  target_channel: string | null;
  status: string | null;
  album_title: string | null;
  artist_name: string | null;
  published_url: string | null;
  admin_memo: string | null;
  created_at: string | null;
};

const statusLabels: Record<string, string> = {
  ISSUED: "발행됨",
  USED: "사용 완료",
  CANCELED: "취소됨",
};

const magazineStatusLabels: Record<string, string> = {
  REQUESTED: "요청 접수",
  WRITING: "작성 중",
  PUBLISHED: "발행 완료",
  CANCELED: "취소됨",
};

const studioStatusLabels: Record<string, string> = {
  REQUESTED: "요청 접수",
  APPROVED: "예약 승인",
  CANCELED: "취소됨",
};

const channelLabels: Record<string, string> = {
  DOMESTIC_NEWS: "국내뉴스",
  MEDIA: "미디어",
};

const formatDate = (value?: string | null) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeZone: "Asia/Seoul",
  }).format(date);
};

const formatReservationDateTime = (date?: string | null, time?: string | null) => {
  const dateText = formatDate(date);
  const timeText = time ? ` ${time.slice(0, 5)}` : "";
  return `${dateText}${timeText}`;
};

const noticeText = (
  error?: string | string[],
  redeemed?: string | string[],
  studioRequested?: string | string[],
) => {
  const rawError = Array.isArray(error) ? error[0] : error;
  if (rawError) {
    try {
      return { type: "error" as const, text: decodeURIComponent(rawError) };
    } catch {
      return { type: "error" as const, text: rawError };
    }
  }
  const redeemedFlag = Array.isArray(redeemed) ? redeemed[0] : redeemed;
  if (redeemedFlag) {
    return {
      type: "success" as const,
      text: "크레딧 이용권이 발행되었습니다. 쿠폰코드를 확인해주세요.",
    };
  }
  const studioRequestedFlag = Array.isArray(studioRequested)
    ? studioRequested[0]
    : studioRequested;
  if (studioRequestedFlag) {
    return {
      type: "success" as const,
      text: "녹음실 예약 요청이 접수되었습니다. 관리자 승인 후 안내 문구를 확인할 수 있습니다.",
    };
  }
  return null;
};

function SummaryCard({
  label,
  value,
  description,
  tone,
}: {
  label: string;
  value: number;
  description: string;
  tone: string;
}) {
  return (
    <div className={`rounded-[10px] border-2 p-5 ${tone}`}>
      <p className="text-[11px] font-black uppercase tracking-normal opacity-70">
        {label}
      </p>
      <p className="mt-2 text-4xl font-black">{value.toLocaleString()}</p>
      <p className="mt-2 text-xs font-semibold leading-5 opacity-75">
        {description}
      </p>
    </div>
  );
}

function RewardCard({
  reward,
  availableCredits,
  contactDefaults,
}: {
  reward: CreditReward;
  availableCredits: number;
  contactDefaults?: StudioReservationContactDefaults;
}) {
  const canRedeem = availableCredits >= reward.credits_required;
  const studioUrl = getCreditRewardStudioUrl(reward.title);

  return (
    <article className="flex min-h-[220px] flex-col justify-between rounded-[10px] border-2 border-[#111111] bg-card p-5 shadow-[5px_5px_0_#111111] dark:border-[#f2cf27] dark:shadow-[5px_5px_0_#f2cf27]">
      <div>
        <div className="flex items-start justify-between gap-4">
          <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] border-2 border-[#111111] bg-[#f2cf27] text-[#111111]">
            <Gift className="h-5 w-5" aria-hidden="true" />
          </span>
          <span className="rounded-[8px] border-2 border-[#111111] bg-background px-3 py-1 text-sm font-black text-foreground">
            {reward.credits_required.toLocaleString()} 크레딧
          </span>
        </div>
        <h2 className="mt-4 text-xl font-black leading-snug text-foreground">
          {reward.title}
        </h2>
        {reward.description ? (
          <p className="mt-3 text-sm font-semibold leading-6 text-muted-foreground">
            {reward.description}
          </p>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2 text-[11px] font-black text-muted-foreground">
          {reward.service_location ? (
            <span className="rounded-[6px] border border-border bg-background px-2 py-1">
              {reward.service_location}
            </span>
          ) : null}
          {reward.validity_days ? (
            <span className="rounded-[6px] border border-border bg-background px-2 py-1">
              발행 후 {reward.validity_days}일
            </span>
          ) : null}
        </div>
      </div>
      <div className="mt-5 space-y-2">
        {studioUrl ? (
          <a
            href={studioUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[8px] border-2 border-[#111111] bg-background px-4 py-3 text-sm font-black text-foreground transition hover:-translate-y-0.5 hover:bg-[#f2cf27]"
          >
            녹음실 살펴보기
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
          </a>
        ) : null}
        {studioUrl ? (
          <StudioReservationForm
            reward={reward}
            canRedeem={canRedeem}
            redirectTo="/mypage/credits"
            contactDefaults={contactDefaults}
          />
        ) : (
          <form action={redeemCreditRewardFormAction}>
            <input type="hidden" name="rewardId" value={reward.id} />
            <button
              type="submit"
              disabled={!canRedeem}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-[8px] border-2 border-[#111111] bg-[#111111] px-4 py-3 text-sm font-black text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:border-border disabled:bg-muted disabled:text-muted-foreground"
            >
              {canRedeem ? "크레딧으로 이용권 발행" : "크레딧 부족"}
            </button>
          </form>
        )}
      </div>
    </article>
  );
}

export default async function MyPageCreditsPage({
  searchParams,
}: {
  searchParams?: Promise<{
    error?: string | string[];
    redeemed?: string | string[];
    studioRequested?: string | string[];
  }>;
}) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/mypage/credits");
  }

  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const notice = noticeText(
    resolvedSearchParams?.error,
    resolvedSearchParams?.redeemed,
    resolvedSearchParams?.studioRequested,
  );
  const admin = createAdminClient();

  const [
    summary,
    rewards,
    redemptionsResult,
    submissionsResult,
    magazineRequestsResult,
    studioReservationsResult,
    profileResult,
  ] =
    await Promise.all([
      getUserCreditSummary(admin, user.id),
      listActiveCreditRewards(admin),
      admin
        .from("credit_reward_redemptions")
        .select(
          "id, user_id, reward_id, reward_title, reward_description, credits_spent, coupon_code, status, expires_at, admin_memo, issued_at, used_at, canceled_at, created_at",
        )
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(50),
      admin
        .from("submissions")
        .select("id, title, artist_name, release_date, created_at")
        .eq("user_id", user.id)
        .eq("type", "ALBUM")
        .eq("payment_status", "PAID")
        .order("created_at", { ascending: false })
        .limit(12),
      admin
        .from("magazine_requests")
        .select(
          "id, target_channel, status, album_title, artist_name, published_url, admin_memo, created_at",
        )
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(30),
      admin
        .from("studio_reservation_requests")
        .select(
          "id, user_id, redemption_id, reward_id, reward_title, service_location, status, preferred_date, preferred_time, duration_hours, contact_name, contact_phone, contact_email, notes, approved_message, admin_memo, approved_at, canceled_at, created_at",
        )
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(30),
      admin
        .from("profiles")
        .select("name, phone")
        .eq("user_id", user.id)
        .maybeSingle(),
    ]);

  const redemptions =
    ((redemptionsResult.data ?? []) as CreditRewardRedemption[]) ?? [];
  const creditSources =
    ((submissionsResult.data ?? []) as CreditSourceSubmission[]) ?? [];
  const magazineRequests =
    ((magazineRequestsResult.data ?? []) as UserMagazineRequest[]) ?? [];
  const studioReservations =
    ((studioReservationsResult.data ?? []) as StudioReservationRequest[]) ?? [];
  const profile = profileResult.data as ProfileRow | null;
  const studioRedemptionIds = new Set(
    studioReservations.map((reservation) => reservation.redemption_id),
  );
  const couponRedemptions = redemptions.filter(
    (redemption) => !studioRedemptionIds.has(redemption.id),
  );
  const hasCreditRequests =
    magazineRequests.length > 0 || studioReservations.length > 0;

  return (
    <DashboardShell
      title="나의 크레딧"
      description="음반심의 결제 완료 건으로 적립된 크레딧을 매거진 발행이나 서비스 이용권으로 사용할 수 있습니다."
      activeTab="credits"
      contextLabel="마이페이지"
      action={
        <Link
          href="/magazine"
          className="inline-flex min-h-10 items-center gap-2 rounded-[8px] border-2 border-[#111111] bg-[#f2cf27] px-4 py-2 text-xs font-black text-[#111111] shadow-[3px_3px_0_#111111]"
        >
          <Newspaper className="h-4 w-4" aria-hidden="true" />
          매거진 발행
        </Link>
      }
    >
      <div className="space-y-8">
        {notice ? (
          <div
            className={`rounded-[10px] border-2 px-4 py-3 text-sm font-black ${
              notice.type === "success"
                ? "border-[#1f7a5a] bg-emerald-500/10 text-[#1f7a5a]"
                : "border-[#d9362c] bg-[#d9362c]/10 text-[#d9362c]"
            }`}
          >
            {notice.text}
          </div>
        ) : null}

        <section className="rounded-[10px] border-2 border-[#111111] bg-[#fffaf0] p-5 shadow-[5px_5px_0_#111111] dark:border-[#f2cf27] dark:bg-[#171717] dark:shadow-[5px_5px_0_#f2cf27]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="bauhaus-kicker">Credit Wallet</p>
              <h2 className="mt-3 text-2xl font-black text-foreground">
                결제 완료 음반심의 1건 = 1크레딧
              </h2>
              <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-muted-foreground">
                1크레딧은 매거진 1회 발행에 사용할 수 있고, 크레딧을 모으면
                치킨 쿠폰처럼 녹음실 이용권 등 서비스 쿠폰으로 교환할 수 있습니다.
              </p>
            </div>
            <span className="inline-flex items-center gap-2 rounded-[8px] border-2 border-[#111111] bg-[#f2cf27] px-4 py-2 text-sm font-black text-[#111111]">
              <Coins className="h-4 w-4" aria-hidden="true" />
              사용 가능 {summary.available.toLocaleString()}개
            </span>
          </div>
          <div className="mt-6 grid gap-3 md:grid-cols-4">
            <SummaryCard
              label="총 적립"
              value={summary.earned}
              description="결제 완료된 음반심의 건수"
              tone="border-[#111111] bg-white text-[#111111]"
            />
            <SummaryCard
              label="사용 가능"
              value={summary.available}
              description="지금 교환 가능한 잔여 크레딧"
              tone="border-[#111111] bg-[#f2cf27] text-[#111111]"
            />
            <SummaryCard
              label="매거진 사용"
              value={summary.magazineUsed}
              description="매거진 발행 요청에 사용"
              tone="border-border bg-card text-foreground"
            />
            <SummaryCard
              label="이용권 사용"
              value={summary.rewardUsed}
              description="서비스 쿠폰 교환에 사용"
              tone="border-border bg-card text-foreground"
            />
          </div>
        </section>

        <section>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="bauhaus-kicker">Service Coupon</p>
              <h2 className="mt-3 text-2xl font-black text-foreground">
                크레딧으로 발행 가능한 이용권
              </h2>
            </div>
            <p className="flex max-w-xl gap-2 text-xs font-semibold leading-5 text-muted-foreground">
              <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              교환한 이용권의 쿠폰코드는 아래 발행 내역에 저장됩니다. 현장 사용이나
              예약 확인은 관리자 확인 후 처리됩니다.
            </p>
          </div>
          <div className="mt-5 grid gap-5 md:grid-cols-2">
            {rewards.length > 0 ? (
              rewards.map((reward) => (
                <RewardCard
                  key={reward.id}
                  reward={reward}
                  availableCredits={summary.available}
                  contactDefaults={{
                    name: profile?.name,
                    phone: profile?.phone,
                    email: user.email,
                  }}
                />
              ))
            ) : (
              <div className="rounded-[10px] border-2 border-dashed border-border bg-card p-6 text-sm font-semibold text-muted-foreground">
                현재 교환 가능한 이용권이 없습니다.
              </div>
            )}
          </div>
        </section>

        <section className="rounded-[10px] border-2 border-border bg-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="bauhaus-kicker">Requests</p>
              <h2 className="mt-3 text-2xl font-black text-foreground">
                크레딧 사용 요청 내역
              </h2>
            </div>
            <span className="rounded-[8px] border-2 border-[#111111] bg-background px-3 py-1 text-xs font-black text-foreground">
              {(magazineRequests.length + studioReservations.length).toLocaleString()}건
            </span>
          </div>

          {hasCreditRequests ? (
            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              {magazineRequests.map((request) => (
                <div
                  key={request.id}
                  className="rounded-[10px] border-2 border-border bg-background p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-black uppercase tracking-normal text-muted-foreground">
                        Magazine
                      </p>
                      <p className="mt-1 font-black text-foreground">
                        {request.album_title ?? "앨범명 미입력"}
                      </p>
                    </div>
                    <span className="rounded-[6px] bg-[#f2cf27] px-2.5 py-1 text-[11px] font-black text-[#111111]">
                      {magazineStatusLabels[request.status ?? ""] ??
                        request.status}
                    </span>
                  </div>
                  <p className="mt-2 text-xs font-semibold text-muted-foreground">
                    {request.artist_name ?? "-"} ·{" "}
                    {channelLabels[request.target_channel ?? ""] ??
                      request.target_channel ??
                      "-"}{" "}
                    · 요청일 {formatDate(request.created_at)}
                  </p>
                  {request.published_url ? (
                    <a
                      href={request.published_url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-[8px] border-2 border-[#111111] bg-[#f2cf27] px-3 py-2 text-xs font-black text-[#111111] transition hover:-translate-y-0.5"
                    >
                      발행 페이지 보기
                      <ExternalLink className="h-4 w-4" aria-hidden="true" />
                    </a>
                  ) : null}
                  {request.admin_memo ? (
                    <p className="mt-3 text-xs font-semibold leading-5 text-muted-foreground">
                      관리자 메모: {request.admin_memo}
                    </p>
                  ) : null}
                </div>
              ))}

              {studioReservations.map((reservation) => (
                <div
                  key={reservation.id}
                  className="rounded-[10px] border-2 border-border bg-background p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-black uppercase tracking-normal text-muted-foreground">
                        Studio
                      </p>
                      <p className="mt-1 font-black text-foreground">
                        {reservation.reward_title}
                      </p>
                    </div>
                    <span className="rounded-[6px] bg-[#f2cf27] px-2.5 py-1 text-[11px] font-black text-[#111111]">
                      {studioStatusLabels[reservation.status] ??
                        reservation.status}
                    </span>
                  </div>
                  <p className="mt-2 text-xs font-semibold text-muted-foreground">
                    희망일 {formatReservationDateTime(
                      reservation.preferred_date,
                      reservation.preferred_time,
                    )}{" "}
                    · {reservation.contact_phone}
                  </p>
                  {reservation.status === "APPROVED" &&
                  reservation.approved_message ? (
                    <div className="mt-3 rounded-[8px] border-2 border-[#111111] bg-[#f2cf27] px-3 py-2 text-xs font-black leading-5 text-[#111111]">
                      {reservation.approved_message}
                    </div>
                  ) : null}
                  {reservation.admin_memo ? (
                    <p className="mt-3 text-xs font-semibold leading-5 text-muted-foreground">
                      관리자 메모: {reservation.admin_memo}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-5 rounded-[10px] border-2 border-dashed border-border bg-background p-5 text-sm font-semibold text-muted-foreground">
              아직 크레딧으로 접수한 매거진 발행 또는 녹음실 예약 요청이 없습니다.
            </p>
          )}
        </section>

        <section className="grid gap-6 lg:grid-cols-[1fr_0.86fr]">
          <div className="rounded-[10px] border-2 border-border bg-card p-5">
            <div className="flex items-center gap-2">
              <Ticket className="h-5 w-5 text-[#1556a4]" aria-hidden="true" />
              <h2 className="text-xl font-black text-foreground">
                발행된 이용권
              </h2>
            </div>
            {couponRedemptions.length > 0 ? (
              <div className="mt-5 space-y-3">
                {couponRedemptions.map((redemption) => {
                  const studioUrl = getCreditRewardStudioUrl(
                    redemption.reward_title,
                  );

                  return (
                    <div
                      key={redemption.id}
                      className="rounded-[10px] border-2 border-border bg-background p-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="font-black text-foreground">
                            {redemption.reward_title}
                          </p>
                          <p className="mt-1 text-xs font-semibold text-muted-foreground">
                            {redemption.credits_spent}크레딧 사용 · 발행일{" "}
                            {formatDate(redemption.issued_at)}
                          </p>
                        </div>
                        <span className="rounded-[6px] bg-[#f2cf27] px-2.5 py-1 text-[11px] font-black text-[#111111]">
                          {statusLabels[redemption.status] ?? redemption.status}
                        </span>
                      </div>
                      <div className="mt-4 rounded-[8px] border-2 border-[#111111] bg-[#111111] px-4 py-3 text-white">
                        <p className="text-[10px] font-black uppercase tracking-[0.22em] text-white/60">
                          Coupon Code
                        </p>
                        <p className="mt-1 text-2xl font-black tracking-normal">
                          {redemption.coupon_code}
                        </p>
                      </div>
                      {studioUrl ? (
                        <a
                          href={studioUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-3 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-[8px] border-2 border-[#111111] bg-background px-4 py-2 text-xs font-black text-foreground transition hover:-translate-y-0.5 hover:bg-[#f2cf27]"
                        >
                          녹음실 살펴보기
                          <ExternalLink className="h-4 w-4" aria-hidden="true" />
                        </a>
                      ) : null}
                      <p className="mt-3 text-xs font-semibold leading-5 text-muted-foreground">
                        유효기간 {formatDate(redemption.expires_at)}
                        {redemption.admin_memo
                          ? ` · 관리자 메모: ${redemption.admin_memo}`
                          : ""}
                      </p>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="mt-5 rounded-[10px] border-2 border-dashed border-border bg-background p-5 text-sm font-semibold text-muted-foreground">
                아직 발행된 이용권이 없습니다.
              </p>
            )}
          </div>

          <div className="rounded-[10px] border-2 border-border bg-card p-5">
            <div className="flex items-center gap-2">
              <History className="h-5 w-5 text-[#1556a4]" aria-hidden="true" />
              <h2 className="text-xl font-black text-foreground">
                크레딧 적립 기준
              </h2>
            </div>
            <p className="mt-3 text-sm font-semibold leading-6 text-muted-foreground">
              회원 계정으로 결제 완료된 건은 크레딧이 자동 적립됩니다.
            </p>
            <div className="mt-5 space-y-3">
              {creditSources.length > 0 ? (
                creditSources.map((submission) => (
                  <div
                    key={submission.id}
                    className="rounded-[8px] border-2 border-border bg-background p-4"
                  >
                    <p className="font-black text-foreground">
                      {submission.title ?? "앨범명 미입력"}
                    </p>
                    <p className="mt-1 text-xs font-semibold text-muted-foreground">
                      {submission.artist_name ?? "-"} · 발매일{" "}
                      {submission.release_date ?? "-"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      적립일 {formatDate(submission.created_at)}
                    </p>
                  </div>
                ))
              ) : (
                <p className="rounded-[8px] border-2 border-dashed border-border bg-background p-4 text-sm font-semibold text-muted-foreground">
                  아직 크레딧으로 적립된 음반심의 결제 건이 없습니다.
                </p>
              )}
            </div>
          </div>
        </section>
      </div>
    </DashboardShell>
  );
}
