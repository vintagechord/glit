import Link from "next/link";
import Image from "next/image";
import {
  Coins,
  ExternalLink,
  Gift,
  Info,
  Newspaper,
  Ticket,
} from "lucide-react";

import {
  MagazineRequestForm,
  type MagazineCreditOption,
  type MagazineExistingRequest,
} from "@/features/magazine/magazine-request-form";
import { redeemCreditRewardFormAction } from "@/features/credits/actions";
import {
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

type CreditUseTab = "magazine" | "services";

type MagazinePageSearchParams = {
  tab?: string | string[];
  error?: string | string[];
  redeemed?: string | string[];
};

const emptyCreditSummary: CreditSummary = {
  earned: 0,
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

function CreditUseTabLink({
  tab,
  activeTab,
  title,
  description,
  icon: Icon,
}: {
  tab: CreditUseTab;
  activeTab: CreditUseTab;
  title: string;
  description: string;
  icon: typeof Newspaper;
}) {
  const selected = activeTab === tab;

  return (
    <Link
      href={`/magazine?tab=${tab}#credit-use`}
      role="tab"
      aria-selected={selected}
      className={`flex min-h-[88px] items-center gap-4 rounded-[10px] border-2 p-4 text-left transition ${
        selected
          ? "border-[#111111] bg-[#f2cf27] text-[#111111] shadow-[5px_5px_0_#111111]"
          : "border-border bg-card text-foreground hover:border-[#111111] hover:-translate-y-0.5"
      }`}
    >
      <span
        className={`inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-[8px] border-2 ${
          selected
            ? "border-[#111111] bg-[#111111] text-white"
            : "border-border bg-background text-[#1556a4]"
        }`}
      >
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <span>
        <span className="block text-lg font-black">{title}</span>
        <span className="mt-1 block text-xs font-semibold opacity-75">
          {description}
        </span>
      </span>
    </Link>
  );
}

function CreditServiceRewardCard({
  reward,
  availableCredits,
  isAuthenticated,
}: {
  reward: CreditReward;
  availableCredits: number;
  isAuthenticated: boolean;
}) {
  const canRedeem = isAuthenticated && availableCredits >= reward.credits_required;

  return (
    <article className="flex min-h-[238px] flex-col justify-between rounded-[10px] border-2 border-[#111111] bg-card p-5 shadow-[5px_5px_0_#111111] dark:border-[#f2cf27] dark:shadow-[5px_5px_0_#f2cf27]">
      <div>
        <div className="flex items-start justify-between gap-4">
          <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] border-2 border-[#111111] bg-[#f2cf27] text-[#111111]">
            <Gift className="h-5 w-5" aria-hidden="true" />
          </span>
          <span className="rounded-[8px] border-2 border-[#111111] bg-background px-3 py-1 text-sm font-black text-foreground">
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

      {!isAuthenticated ? (
        <Link
          href={`/login?next=${encodeURIComponent("/magazine?tab=services#credit-use")}`}
          className="mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-[8px] border-2 border-[#111111] bg-[#111111] px-4 py-3 text-sm font-black text-white transition hover:-translate-y-0.5"
        >
          로그인 후 이용
        </Link>
      ) : canRedeem ? (
        <form action={redeemCreditRewardFormAction} className="mt-5">
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
          className="mt-5 inline-flex min-h-11 w-full cursor-not-allowed items-center justify-center rounded-[8px] border-2 border-border bg-muted px-4 py-3 text-sm font-black text-muted-foreground"
        >
          크레딧 부족
        </button>
      )}
    </article>
  );
}

function CreditServiceRewardsPanel({
  rewards,
  creditSummary,
  isAuthenticated,
}: {
  rewards: CreditReward[];
  creditSummary: CreditSummary;
  isAuthenticated: boolean;
}) {
  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="bauhaus-kicker">Service Coupon</p>
          <h2 className="mt-3 text-2xl font-black text-foreground">
            크레딧으로 이용 가능한 서비스
          </h2>
          <p className="mt-3 max-w-3xl text-sm font-semibold leading-6 text-muted-foreground">
            관리자가 등록한 녹음실 이용권과 온사이드 연계 서비스를 크레딧으로
            교환할 수 있습니다. 새 서비스가 추가되면 이 탭에 자동으로 노출됩니다.
          </p>
        </div>
        <div className="rounded-[10px] border-2 border-[#111111] bg-[#f2cf27] px-4 py-3 text-[#111111] shadow-[4px_4px_0_#111111]">
          <p className="text-[11px] font-black uppercase tracking-normal">
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
          className="inline-flex min-h-11 items-center gap-2 rounded-[8px] border-2 border-[#111111] bg-background px-5 py-3 text-sm font-black text-foreground transition hover:-translate-y-0.5 hover:bg-[#f2cf27]"
        >
          <Ticket className="h-4 w-4" aria-hidden="true" />
          보유 크레딧에서 발행 내역 보기
        </Link>
      ) : (
        <p className="flex max-w-2xl gap-2 text-xs font-semibold leading-5 text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          서비스 이용권 발행은 회원 크레딧 기준으로 처리됩니다. 비회원 접수 건은
          회원가입 후 관리자 확인을 통해 크레딧 연결이 필요할 수 있습니다.
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
  );
  const [{ creditOptions, existingRequests, creditSummary }, rewards] =
    await Promise.all([loadMagazineCreditData(user?.id), loadActiveRewards()]);

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
          <p className="w-fit bg-[#f2cf27] px-3 py-1 text-xs font-black uppercase tracking-normal text-[#111111]">
            Onside Credits
          </p>
          <h1 className="font-display mt-5 max-w-3xl text-4xl font-black leading-tight sm:text-5xl">
            온사이드의 크레딧으로 필요한 서비스를 이용하세요.
          </h1>
          <p className="mt-5 max-w-2xl text-base font-semibold leading-7 text-white/82">
            앨범심의 결제 완료 건마다 크레딧 1개가 발급됩니다. 크레딧은 매거진
            발행, 녹음실 이용권 등 관리자가 등록한 온사이드 연계 서비스에 사용할 수
            있습니다.
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
            <Link
              href="#credit-use"
              className="inline-flex min-h-11 items-center rounded-[8px] border-2 border-white bg-white/10 px-5 py-3 text-sm font-black text-white transition hover:-translate-y-0.5 hover:bg-white hover:text-[#111111]"
            >
              크레딧 사용하기
            </Link>
          </div>
        </div>
      </section>

      <div className="mx-auto w-full max-w-6xl px-6 py-12">
        <section className="rounded-[10px] border-2 border-[#111111] bg-[#f2cf27] p-5 text-[#111111] shadow-[5px_5px_0_#111111] md:p-6">
          <p className="text-xs font-black uppercase tracking-normal">
            Credit
          </p>
          <h2 className="mt-3 text-2xl font-black">
            앨범심의 결제 완료 1건당 크레딧 1개가 발급됩니다.
          </h2>
          <p className="mt-3 max-w-3xl text-sm font-semibold leading-6">
            크레딧으로 워터멜론 매거진 발행 요청, 녹음실 이용권, 관리자가 추가하는
            온사이드 연계 서비스를 이용할 수 있습니다.
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

          <div className="mb-6">
            <p className="bauhaus-kicker">Credit Use</p>
            <h2 className="mt-3 text-2xl font-black text-foreground">
              사용처 선택
            </h2>
            <div
              role="tablist"
              aria-label="크레딧 사용처"
              className="mt-4 grid gap-3 md:grid-cols-2"
            >
              <CreditUseTabLink
                tab="magazine"
                activeTab={activeTab}
                title="워터멜론 매거진"
                description="1크레딧으로 발행 요청"
                icon={Newspaper}
              />
              <CreditUseTabLink
                tab="services"
                activeTab={activeTab}
                title="서비스 이용권"
                description="녹음실 등 관리자 등록 서비스"
                icon={Gift}
              />
            </div>
          </div>

          {activeTab === "magazine" ? (
            <MagazineRequestForm
              isAuthenticated={Boolean(user)}
              userEmail={user?.email ?? null}
              creditOptions={creditOptions}
              existingRequests={existingRequests}
              availableCredits={creditSummary.available}
            />
          ) : (
            <CreditServiceRewardsPanel
              rewards={rewards}
              creditSummary={creditSummary}
              isAuthenticated={Boolean(user)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
