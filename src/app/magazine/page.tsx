import Link from "next/link";
import Image from "next/image";
import {
  Coins,
  ExternalLink,
  Gift,
  Info,
  Ticket,
} from "lucide-react";

import { CreditUseTabs, type CreditUseTab } from "./credit-use-tabs";
import {
  MagazineRequestForm,
  type MagazineCreditOption,
  type MagazineExistingRequest,
} from "@/features/magazine/magazine-request-form";
import {
  StudioReservationForm,
  type StudioReservationContactDefaults,
} from "@/features/credits/studio-reservation-form";
import { redeemCreditRewardFormAction } from "@/features/credits/actions";
import {
  getCreditRewardStudioUrl,
  getUserCreditSummary,
  listActiveCreditRewards,
  type CreditReward,
  type CreditSummary,
} from "@/lib/credits";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "크레딧",
  description:
    "음반심의 결제 완료 건으로 발급되는 온사이드 크레딧을 확인하고 사용하세요.",
};

type SubmissionCreditRow = {
  id: string;
  title: string | null;
  artist_name: string | null;
  release_date: string | null;
  created_at: string | null;
  applicant_name: string | null;
  applicant_email: string | null;
  applicant_phone: string | null;
};

type MagazineRequestRow = {
  id: string;
  submission_id: string | null;
  status: string | null;
  target_channel: string | null;
  album_title: string | null;
  artist_name: string | null;
  created_at: string | null;
  published_url: string | null;
};

type MagazinePageSearchParams = {
  tab?: string | string[];
  error?: string | string[];
  redeemed?: string | string[];
  studioRequested?: string | string[];
};

const emptyCreditSummary: CreditSummary = {
  earned: 0,
  adminGranted: 0,
  magazineUsed: 0,
  rewardUsed: 0,
  used: 0,
  available: 0,
};

const firstParam = (value?: string | string[]) =>
  Array.isArray(value) ? value[0] : value;

const noticeText = (
  error?: string | string[],
  redeemed?: string | string[],
  studioRequested?: string | string[],
) => {
  const rawError = firstParam(error);
  if (rawError) {
    try {
      return { type: "error" as const, text: decodeURIComponent(rawError) };
    } catch {
      return { type: "error" as const, text: rawError };
    }
  }

  if (firstParam(redeemed)) {
    return {
      type: "success" as const,
      text: "크레딧 이용권이 발행되었습니다. 쿠폰코드는 보유 크레딧 페이지에서도 확인할 수 있습니다.",
    };
  }

  if (firstParam(studioRequested)) {
    return {
      type: "success" as const,
      text: "녹음실 예약 요청이 접수되었습니다. 관리자 승인 후 안내 문구가 표시됩니다.",
    };
  }

  return null;
};

async function loadMagazineCreditData(userId?: string | null) {
  if (!userId) {
    return {
      creditOptions: [] as MagazineCreditOption[],
      existingRequests: [] as MagazineExistingRequest[],
      creditSummary: emptyCreditSummary,
    };
  }

  const admin = createAdminClient();
  const creditSummary = await getUserCreditSummary(admin, userId);
  const { data: paidSubmissions, error: submissionError } = await admin
    .from("submissions")
    .select(
      "id, title, artist_name, release_date, created_at, applicant_name, applicant_email, applicant_phone",
    )
    .eq("user_id", userId)
    .eq("type", "ALBUM")
    .eq("payment_status", "PAID")
    .order("created_at", { ascending: false })
    .limit(80);

  if (submissionError) {
    console.error("[magazine] failed to load credit submissions", submissionError);
  }

  const paidRows = (paidSubmissions ?? []) as SubmissionCreditRow[];
  const paidIds = paidRows.map((submission) => submission.id);

  const [usedResult, existingResult] = await Promise.all([
    paidIds.length > 0
      ? admin
          .from("magazine_requests")
          .select("submission_id")
          .in("submission_id", paidIds)
      : Promise.resolve({ data: [], error: null }),
    admin
      .from("magazine_requests")
      .select(
        "id, submission_id, status, target_channel, album_title, artist_name, created_at, published_url",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  if (usedResult.error) {
    console.error("[magazine] failed to load used credits", usedResult.error);
  }
  if (existingResult.error) {
    console.error(
      "[magazine] failed to load existing requests",
      existingResult.error,
    );
  }

  const usedSubmissionIds = new Set(
    ((usedResult.data ?? []) as Array<{ submission_id?: string | null }>)
      .map((row) => row.submission_id)
      .filter((id): id is string => Boolean(id)),
  );

  return {
    creditSummary,
    creditOptions: paidRows
      .filter((submission) => !usedSubmissionIds.has(submission.id))
      .map((submission) => ({
        id: submission.id,
        title: submission.title,
        artistName: submission.artist_name,
        releaseDate: submission.release_date,
        createdAt: submission.created_at,
        applicantName: submission.applicant_name,
        applicantEmail: submission.applicant_email,
        applicantPhone: submission.applicant_phone,
      })),
    existingRequests: ((existingResult.data ?? []) as MagazineRequestRow[]).map(
      (request) => ({
        id: request.id,
        status: request.status,
        targetChannel: request.target_channel,
        albumTitle: request.album_title,
        artistName: request.artist_name,
        createdAt: request.created_at,
        publishedUrl: request.published_url,
      }),
    ),
  };
}

async function loadActiveRewards() {
  try {
    return await listActiveCreditRewards(createAdminClient());
  } catch (error) {
    console.error("[magazine] failed to load credit rewards", error);
    return [] as CreditReward[];
  }
}

function CreditServiceRewardCard({
  reward,
  availableCredits,
  isAuthenticated,
  contactDefaults,
}: {
  reward: CreditReward;
  availableCredits: number;
  isAuthenticated: boolean;
  contactDefaults?: StudioReservationContactDefaults;
}) {
  const canRedeem = isAuthenticated && availableCredits >= reward.credits_required;
  const studioUrl = getCreditRewardStudioUrl(reward.title);

  return (
    <article className="flex min-h-[238px] flex-col justify-between rounded-[10px] border-2 border-[#111111] bg-card p-5 shadow-[5px_5px_0_#111111] dark:border-white/70 dark:shadow-[5px_5px_0_#1556a4]">
      <div>
        <div className="flex items-start justify-between gap-4">
          <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] border-2 border-[#111111] bg-[#111111] text-white">
            <Gift className="h-5 w-5" aria-hidden="true" />
          </span>
          <span className="rounded-[8px] border-2 border-[#1556a4] bg-[#eaf2fb] px-3 py-1 text-sm font-black text-[#1556a4] dark:border-[#8bc3ff] dark:bg-[#102033] dark:text-[#8bc3ff]">
            {reward.credits_required.toLocaleString()} 크레딧
          </span>
        </div>
        <h3 className="mt-4 text-xl font-black leading-snug text-foreground">
          {reward.title}
        </h3>
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
            className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[8px] border-2 border-[#111111] bg-background px-4 py-3 text-sm font-black text-foreground transition hover:-translate-y-0.5 hover:border-[#1556a4] hover:bg-[#eaf2fb] dark:hover:bg-[#102033]"
          >
            녹음실 살펴보기
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
          </a>
        ) : null}

        {!isAuthenticated ? (
          <Link
            href={`/login?next=${encodeURIComponent("/magazine?tab=services#credit-use")}`}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-[8px] border-2 border-[#111111] bg-[#111111] px-4 py-3 text-sm font-black text-white transition hover:-translate-y-0.5"
          >
            로그인 후 이용
          </Link>
        ) : studioUrl ? (
          <StudioReservationForm
            reward={reward}
            canRedeem={canRedeem}
            redirectTo="/magazine?tab=services#credit-use"
            contactDefaults={contactDefaults}
          />
        ) : canRedeem ? (
          <form action={redeemCreditRewardFormAction}>
            <input type="hidden" name="rewardId" value={reward.id} />
            <input
              type="hidden"
              name="redirectTo"
              value="/magazine?tab=services#credit-use"
            />
            <button
              type="submit"
              className="inline-flex min-h-11 w-full items-center justify-center rounded-[8px] border-2 border-[#111111] bg-[#111111] px-4 py-3 text-sm font-black text-white transition hover:-translate-y-0.5"
            >
              크레딧으로 이용권 발행
            </button>
          </form>
        ) : (
          <button
            type="button"
            disabled
            className="inline-flex min-h-11 w-full cursor-not-allowed items-center justify-center rounded-[8px] border-2 border-border bg-muted px-4 py-3 text-sm font-black text-muted-foreground"
          >
            크레딧 부족
          </button>
        )}
      </div>
    </article>
  );
}

function CreditServiceRewardsPanel({
  rewards,
  creditSummary,
  isAuthenticated,
  contactDefaults,
}: {
  rewards: CreditReward[];
  creditSummary: CreditSummary;
  isAuthenticated: boolean;
  contactDefaults?: StudioReservationContactDefaults;
}) {
  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-foreground">
            서비스 이용권 목록
          </h2>
          <p className="mt-3 max-w-3xl text-sm font-semibold leading-6 text-muted-foreground">
            녹음실 예약 등 현재 신청 가능한 이용권입니다. 새 서비스가 추가되면
            이 목록에 표시됩니다.
          </p>
        </div>
        <div className="rounded-[10px] border-2 border-[#111111] bg-[#111111] px-4 py-3 text-white shadow-[4px_4px_0_#1556a4]">
          <p className="text-[11px] font-black uppercase tracking-normal text-white/68">
            사용 가능
          </p>
          <p className="mt-1 flex items-center gap-2 text-2xl font-black">
            <Coins className="h-5 w-5" aria-hidden="true" />
            {isAuthenticated
              ? `${creditSummary.available.toLocaleString()}개`
              : "로그인 필요"}
          </p>
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        {rewards.length > 0 ? (
          rewards.map((reward) => (
            <CreditServiceRewardCard
              key={reward.id}
              reward={reward}
              availableCredits={creditSummary.available}
              isAuthenticated={isAuthenticated}
              contactDefaults={contactDefaults}
            />
          ))
        ) : (
          <div className="rounded-[10px] border-2 border-dashed border-border bg-card p-6 text-sm font-semibold text-muted-foreground">
            현재 교환 가능한 서비스 이용권이 없습니다. 관리자 등록 후 이 탭에
            서비스가 표시됩니다.
          </div>
        )}
      </div>

      {isAuthenticated ? (
        <Link
          href="/mypage/credits"
          className="inline-flex min-h-11 items-center gap-2 rounded-[8px] border-2 border-[#111111] bg-background px-5 py-3 text-sm font-black text-foreground transition hover:-translate-y-0.5 hover:border-[#1556a4] hover:bg-[#eaf2fb] dark:hover:bg-[#102033]"
        >
          <Ticket className="h-4 w-4" aria-hidden="true" />
          보유 크레딧에서 발행 내역 보기
        </Link>
      ) : (
        <p className="flex max-w-2xl gap-2 text-xs font-semibold leading-5 text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          크레딧 사용은 회원 계정으로 결제 완료된 음반심의 건에 대해서만
          가능합니다. 로그인 후 이용해주세요.
        </p>
      )}
    </section>
  );
}

export default async function MagazinePage({
  searchParams,
}: {
  searchParams?: Promise<MagazinePageSearchParams>;
}) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const activeTab: CreditUseTab =
    firstParam(resolvedSearchParams?.tab) === "services"
      ? "services"
      : "magazine";
  const notice = noticeText(
    resolvedSearchParams?.error,
    resolvedSearchParams?.redeemed,
    resolvedSearchParams?.studioRequested,
  );
  const admin = createAdminClient();
  const [{ creditOptions, existingRequests, creditSummary }, rewards, profileResult] =
    await Promise.all([
      loadMagazineCreditData(user?.id),
      loadActiveRewards(),
      user
        ? admin
            .from("profiles")
            .select("name, phone")
            .eq("user_id", user.id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
  const profile = profileResult.data as {
    name?: string | null;
    phone?: string | null;
  } | null;

  return (
    <div className="bg-background">
      <section className="relative min-h-[500px] overflow-hidden border-b-2 border-[#111111] dark:border-[#f2cf27]">
        <Image
          src="/media/hero/onside-hero-poster.jpg"
          alt=""
          fill
          priority
          sizes="100vw"
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-[#111111]/68" />
        <div className="relative mx-auto flex min-h-[500px] w-full max-w-6xl flex-col justify-end px-6 pb-10 pt-24 text-white">
          <h1 className="font-display max-w-3xl text-4xl font-black leading-tight sm:text-5xl">
            크레딧으로 온사이드 연계 서비스를 이용하세요
          </h1>
          <p className="mt-5 max-w-2xl text-base font-semibold leading-7 text-white/82">
            앨범심의 신청 후 지급된 크레딧으로 매거진 발행 요청, 녹음실 이용권 등
            다양한 연계 서비스를 선택할 수 있습니다.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <a
              href="https://www.iamwatermelon.com/ko/service/magazine/list/1/1"
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center gap-2 rounded-[8px] border-2 border-[#f2cf27] bg-[#f2cf27] px-5 py-3 text-sm font-black text-[#111111] shadow-[4px_4px_0_#111111] transition hover:-translate-y-0.5"
            >
              매거진 바로가기
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
            </a>
            <a
              href="#credit-use"
              className="inline-flex min-h-11 items-center rounded-[8px] border-2 border-white bg-white/10 px-5 py-3 text-sm font-black text-white transition hover:-translate-y-0.5 hover:bg-white hover:text-[#111111]"
            >
              크레딧 사용하기
            </a>
          </div>
        </div>
      </section>

      <div className="mx-auto w-full max-w-6xl px-6 py-12">
        <section className="relative overflow-hidden rounded-[10px] border-2 border-[#111111] bg-[#f2cf27] p-5 text-[#111111] shadow-[5px_5px_0_#111111] dark:border-[#f2cf27] dark:shadow-[5px_5px_0_#1556a4] md:p-6">
          <p className="relative w-fit rounded-[6px] border-2 border-[#111111] bg-white px-2.5 py-1 text-xs font-black text-[#111111]">
            크레딧 안내
          </p>
          <h2 className="relative mt-3 text-2xl font-black">
            앨범심의 결제 완료 1건당 크레딧 1개가 지급됩니다.
          </h2>
          <p className="relative mt-3 max-w-3xl text-sm font-semibold leading-6 text-[#111111]/78">
            지급된 크레딧은 온사이드가 제공하는 연계 서비스 신청에 사용할 수
            있습니다.
          </p>
        </section>

        <div id="credit-use" className="mt-8 scroll-mt-28">
          {notice ? (
            <div
              className={`mb-5 rounded-[10px] border-2 px-4 py-3 text-sm font-black ${
                notice.type === "success"
                  ? "border-[#1f7a5a] bg-emerald-500/10 text-[#1f7a5a]"
                  : "border-[#d9362c] bg-[#d9362c]/10 text-[#d9362c]"
              }`}
            >
              {notice.text}
            </div>
          ) : null}

          <CreditUseTabs
            initialTab={activeTab}
            magazinePanel={
              <MagazineRequestForm
                isAuthenticated={Boolean(user)}
                userEmail={user?.email ?? null}
                creditOptions={creditOptions}
                existingRequests={existingRequests}
                availableCredits={creditSummary.available}
              />
            }
            servicesPanel={
              <CreditServiceRewardsPanel
                rewards={rewards}
                creditSummary={creditSummary}
                isAuthenticated={Boolean(user)}
                contactDefaults={{
                  name: profile?.name,
                  phone: profile?.phone,
                  email: user?.email,
                }}
              />
            }
          />
        </div>
      </div>
    </div>
  );
}
