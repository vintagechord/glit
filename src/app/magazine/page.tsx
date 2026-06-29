import Link from "next/link";
import Image from "next/image";
import { ExternalLink, Globe2, Info, Languages, Newspaper } from "lucide-react";

import {
  MagazineRequestForm,
  type MagazineCreditOption,
  type MagazineExistingRequest,
} from "@/features/magazine/magazine-request-form";
import { getUserCreditSummary, type CreditSummary } from "@/lib/credits";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "매거진 발행 요청",
  description:
    "음반심의 결제 완료 건으로 워터멜론 매거진 발행 요청을 접수하세요.",
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

const emptyCreditSummary: CreditSummary = {
  earned: 0,
  magazineUsed: 0,
  rewardUsed: 0,
  used: 0,
  available: 0,
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

const featureItems = [
  {
    title: "1회 무료 발행",
    description: "음반심의 결제 완료 1건마다 매거진 크레딧 1개 제공",
    icon: Info,
  },
  {
    title: "국내뉴스 또는 미디어",
    description: "워터멜론 내 두 발행 위치 중 하나를 선택",
    icon: Newspaper,
  },
  {
    title: "4개 언어 발행",
    description: "워터멜론 매거진은 다국어 독자에게 노출",
    icon: Languages,
  },
  {
    title: "발매 후 신청 가능",
    description: "앨범 링크와 영상 링크는 발매 후 제출해도 무방",
    icon: Globe2,
  },
];

export default async function MagazinePage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { creditOptions, existingRequests, creditSummary } = await loadMagazineCreditData(
    user?.id,
  );

  return (
    <div className="bg-background">
      <section className="relative min-h-[520px] overflow-hidden border-b-2 border-[#111111] dark:border-[#f2cf27]">
        <Image
          src="/media/hero/onside-hero-poster.jpg"
          alt=""
          fill
          priority
          sizes="100vw"
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-[#111111]/68" />
        <div className="relative mx-auto flex min-h-[520px] w-full max-w-6xl flex-col justify-end px-6 pb-10 pt-24 text-white">
          <p className="w-fit bg-[#f2cf27] px-3 py-1 text-xs font-black uppercase tracking-normal text-[#111111]">
            Watermelon Magazine
          </p>
          <h1 className="font-display mt-5 max-w-3xl text-4xl font-black leading-tight sm:text-5xl">
            음반심의 결제 1건으로 매거진 발행까지 요청하세요.
          </h1>
          <p className="mt-5 max-w-2xl text-base font-semibold leading-7 text-white/82">
            온사이드 음반심의 의뢰자는 결제 완료 건당 1회 무료로 워터멜론
            국내뉴스 또는 미디어 매거진 발행 요청을 할 수 있습니다. 공개는
            발매일 기준 3일 내 진행을 목표로 안내합니다.
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
              href={user ? "#request" : "/signup"}
              className="inline-flex min-h-11 items-center rounded-[8px] border-2 border-white bg-white/10 px-5 py-3 text-sm font-black text-white transition hover:-translate-y-0.5 hover:bg-white hover:text-[#111111]"
            >
              {user ? "발행 요청하기" : "회원가입 후 크레딧 사용"}
            </Link>
          </div>
        </div>
      </section>

      <div className="mx-auto w-full max-w-6xl px-6 py-12">
        <section className="grid gap-4 md:grid-cols-4">
          {featureItems.map((item) => {
            const Icon = item.icon;
            return (
              <div
                key={item.title}
                className="min-h-[150px] rounded-[10px] border-2 border-border bg-card p-5"
              >
                <Icon className="h-5 w-5 text-[#1556a4]" aria-hidden="true" />
                <h2 className="mt-4 text-base font-black text-foreground">
                  {item.title}
                </h2>
                <p className="mt-2 text-sm font-semibold leading-6 text-muted-foreground">
                  {item.description}
                </p>
              </div>
            );
          })}
        </section>

        <section className="mt-10 grid gap-6 lg:grid-cols-[0.88fr_1fr]">
          <div className="space-y-5">
            <div className="rounded-[10px] border-2 border-[#111111] bg-[#f2cf27] p-5 text-[#111111] shadow-[5px_5px_0_#111111]">
              <p className="text-xs font-black uppercase tracking-normal">
                Credit Rule
              </p>
              <h2 className="mt-3 text-2xl font-black">
                결제 완료 음반심의 1건 = 매거진 크레딧 1개
              </h2>
              <p className="mt-3 text-sm font-semibold leading-6">
                같은 음반심의 접수 건으로는 한 번만 요청할 수 있습니다. 회원은
                로그인 후 남은 크레딧을 선택하고, 비회원은 진행/결과 조회 코드를
                입력해 본인 접수를 확인합니다.
              </p>
            </div>
            <div className="rounded-[10px] border-2 border-border bg-card p-5">
              <p className="bauhaus-kicker">Optional</p>
              <h2 className="mt-3 text-xl font-black text-foreground">
                링크와 자료는 발매 후 보강 가능
              </h2>
              <p className="mt-3 text-sm font-semibold leading-6 text-muted-foreground">
                영상 링크, 발매된 앨범 링크, 아트워크, 직접 작성한 기사 내용,
                크레딧 정보는 선택 입력입니다. 발매 후 확보되는 자료가 있다면
                발매 이후에 신청해도 문제 없습니다.
              </p>
            </div>
          </div>
          <div className="rounded-[10px] border-2 border-border bg-card p-5">
            <p className="bauhaus-kicker">Publish Flow</p>
            <h2 className="mt-3 text-xl font-black text-foreground">
              접수 후 진행 방식
            </h2>
            <div className="mt-5 grid gap-3">
              {[
                "결제 완료 음반심의 건으로 매거진 크레딧 확인",
                "국내뉴스 또는 미디어 중 발행 위치 선택",
                "제출 자료 확인 후 기사 작성 및 다국어 발행 준비",
                "발매일 기준 3일 내 공개 목표로 진행 상황 안내",
              ].map((step, index) => (
                <div
                  key={step}
                  className="flex gap-3 rounded-[8px] border-2 border-border bg-background p-4"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-[#1556a4] text-xs font-black text-white">
                    {index + 1}
                  </span>
                  <p className="text-sm font-semibold leading-6 text-foreground">
                    {step}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <div id="request" className="mt-12 scroll-mt-28">
          <MagazineRequestForm
            isAuthenticated={Boolean(user)}
            userEmail={user?.email ?? null}
            creditOptions={creditOptions}
            existingRequests={existingRequests}
            availableCredits={creditSummary.available}
          />
        </div>
      </div>
    </div>
  );
}
