import Link from "next/link";
import Image from "next/image";
import {
  ExternalLink,
  Gift,
  Info,
  Ticket,
} from "lucide-react";

import { CreditUseTabs, type CreditUseTab } from "./credit-use-tabs";
import {
  MagazineRequestForm,
  type MagazineExistingRequest,
} from "@/features/magazine/magazine-request-form";
import {
  StudioReservationForm,
  type StudioReservationContactDefaults,
} from "@/features/credits/studio-reservation-form";
import {
  CreditActionNotice,
  type CreditActionNoticeState,
} from "@/features/credits/credit-action-notice";
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

export type MagazinePageSearchParams = {
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
  localePrefix: "" | "/en" = "",
): CreditActionNoticeState | null => {
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
      title: "서비스 이용 요청 접수",
      text: "서비스 이용 요청이 접수되었습니다. 관리자 승인 후 안내 문구가 표시됩니다.",
      actionHref: `${localePrefix}/mypage/credits#credit-requests`,
      actionLabel: "요청 내역 보기",
      clearQueryParams: ["redeemed"],
    };
  }

  if (firstParam(studioRequested)) {
    return {
      type: "success" as const,
      title: "녹음실 사용 신청 완료",
      text:
        "녹음실 예약 요청이 접수되었습니다. 관리자 승인 후 안내 문구가 표시됩니다.\n적어주신 연락처로 녹음실 사용 안내를 드립니다.",
      actionHref: `${localePrefix}/mypage/credits#credit-requests`,
      actionLabel: "요청 내역 보기",
      clearQueryParams: ["studioRequested"],
    };
  }

  return null;
};

async function loadMagazineCreditData(userId?: string | null) {
  if (!userId) {
    return {
      existingRequests: [] as MagazineExistingRequest[],
      creditSummary: emptyCreditSummary,
    };
  }

  const admin = createAdminClient();
  const creditSummary = await getUserCreditSummary(admin, userId);
  const existingResult = await admin
    .from("magazine_requests")
    .select(
      "id, submission_id, status, target_channel, album_title, artist_name, created_at, published_url",
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(30);

  if (existingResult.error) {
    console.error(
      "[magazine] failed to load existing requests",
      existingResult.error,
    );
  }

  return {
    creditSummary,
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
  localePrefix,
}: {
  reward: CreditReward;
  availableCredits: number;
  isAuthenticated: boolean;
  contactDefaults?: StudioReservationContactDefaults;
  localePrefix: "" | "/en";
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
          <span className="rounded-[8px] border-2 border-[#111111] bg-[#d9362c] px-3 py-1 text-sm font-black text-white shadow-[3px_3px_0_#111111] dark:border-[#f2cf27] dark:bg-[#ff6258] dark:text-[#111111] dark:shadow-[3px_3px_0_#f2cf27]">
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
            href={`${localePrefix}/login?next=${encodeURIComponent(`${localePrefix}/magazine?tab=services#credit-use`)}`}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-[8px] border-2 border-[#111111] bg-[#111111] px-4 py-3 text-sm font-black text-white transition hover:-translate-y-0.5"
          >
            로그인 후 이용
          </Link>
        ) : canRedeem ? (
          <StudioReservationForm
            reward={reward}
            canRedeem={canRedeem}
            redirectTo={`${localePrefix}/magazine?tab=services#credit-use`}
            contactDefaults={contactDefaults}
          />
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
  localePrefix,
}: {
  rewards: CreditReward[];
  creditSummary: CreditSummary;
  isAuthenticated: boolean;
  contactDefaults?: StudioReservationContactDefaults;
  localePrefix: "" | "/en";
}) {
  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-foreground">
            서비스 이용 요청
          </h2>
          <p className="mt-3 max-w-3xl text-sm font-semibold leading-6 text-muted-foreground">
            녹음실 예약 등 현재 신청 가능한 서비스입니다.
          </p>
        </div>
        <div className="min-w-[156px] rounded-[8px] border-2 border-border bg-card p-4">
          <p className="text-[11px] font-black uppercase tracking-normal text-muted-foreground">
            보유 크레딧
          </p>
          <p className="mt-2 text-3xl font-black text-foreground">
            {isAuthenticated ? creditSummary.available.toLocaleString() : "-"}
          </p>
          {!isAuthenticated ? (
            <p className="mt-1 text-[11px] font-semibold text-muted-foreground">
              로그인 필요
            </p>
          ) : null}
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
              localePrefix={localePrefix}
            />
          ))
        ) : (
          <div className="rounded-[10px] border-2 border-dashed border-border bg-card p-6 text-sm font-semibold text-muted-foreground">
            현재 신청 가능한 서비스가 없습니다.
          </div>
        )}
      </div>

      {isAuthenticated ? (
        <Link
          href={`${localePrefix}/mypage/credits#credit-requests`}
          className="inline-flex min-h-11 items-center gap-2 rounded-[8px] border-2 border-[#111111] bg-background px-5 py-3 text-sm font-black text-foreground transition hover:-translate-y-0.5 hover:border-[#1556a4] hover:bg-[#eaf2fb] dark:hover:bg-[#102033]"
        >
          <Ticket className="h-4 w-4" aria-hidden="true" />
          크레딧 요청 내역 보기
        </Link>
      ) : (
        <p className="flex max-w-2xl gap-2 text-xs font-semibold leading-5 text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          크레딧 사용은 보유 크레딧이 있는 회원만 가능합니다. 로그인 후
          이용해주세요.
        </p>
      )}
    </section>
  );
}

export async function MagazinePageView({
  searchParams,
  localePrefix = "",
}: {
  searchParams?: Promise<MagazinePageSearchParams>;
  localePrefix?: "" | "/en";
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
    localePrefix,
  );
  const admin = createAdminClient();
  const [{ existingRequests, creditSummary }, rewards, profileResult] =
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
      <div className="mx-auto w-full max-w-6xl px-6 py-12">
        <section className="relative min-h-[178px] overflow-hidden rounded-[10px] border-2 border-[#111111] bg-[#1556a4] p-5 text-white shadow-[5px_5px_0_#111111] dark:border-[#8bc3ff] dark:shadow-[5px_5px_0_#8bc3ff] md:p-7">
          <Image
            src="/media/banners/credit-wallet.svg"
            alt=""
            aria-hidden="true"
            fill
            sizes="(min-width: 1024px) 1152px, 100vw"
            className="pointer-events-none absolute inset-y-0 right-0 h-full w-full object-cover object-right opacity-70"
          />
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(6,17,31,0.94)_0%,rgba(21,86,164,0.88)_48%,rgba(21,86,164,0.42)_100%)]" />
          <p className="relative w-fit rounded-[6px] border-2 border-white bg-white px-2.5 py-1 text-xs font-black text-[#111111]">
            크레딧 안내
          </p>
          <h2 className="relative mt-3 max-w-3xl text-2xl font-black">
            앨범심의 결제 완료 1건당 크레딧 1개가 지급됩니다.
          </h2>
          <p className="relative mt-3 max-w-3xl text-sm font-semibold leading-6 text-white/82">
            지급된 크레딧은 온사이드가 제공하는 연계 서비스 신청에 사용할 수
            있습니다.
          </p>
        </section>

        <div id="credit-use" className="mt-8 scroll-mt-28">
          <CreditActionNotice notice={notice} />

          <CreditUseTabs
            initialTab={activeTab}
            magazineAction={
              <a
                href="https://www.iamwatermelon.com/ko/service/magazine/list/1/1"
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[8px] border-2 border-[#111111] bg-white px-5 py-3 text-sm font-black text-[#111111] shadow-[3px_3px_0_#111111] transition hover:-translate-y-0.5 sm:w-auto"
              >
                매거진 바로가기
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
              </a>
            }
            magazinePanel={
              <div>
                <MagazineRequestForm
                  isAuthenticated={Boolean(user)}
                  requesterPhone={profile?.phone}
                  existingRequests={existingRequests}
                  availableCredits={creditSummary.available}
                />
              </div>
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
                localePrefix={localePrefix}
              />
            }
          />
        </div>
      </div>
    </div>
  );
}

export default async function MagazinePage({
  searchParams,
}: {
  searchParams?: Promise<MagazinePageSearchParams>;
}) {
  return MagazinePageView({ searchParams });
}
