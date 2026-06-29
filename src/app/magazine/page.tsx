import Link from "next/link";
import Image from "next/image";
import { ExternalLink } from "lucide-react";

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

const heroBadges = [
  "앨범심의 1건 = 1크레딧",
  "매거진 1회 발행 요청",
  "국내뉴스 / 미디어 선택",
  "4개 언어 발행",
  "발매 후 신청 가능",
  "발매일 기준 3일 내 목표",
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
            음반심의 1건으로 크레딧을 받고, 필요한 서비스를 이용하세요.
          </h1>
          <p className="mt-5 max-w-2xl text-base font-semibold leading-7 text-white/82">
            앨범심의 결제 완료 건마다 크레딧 1개가 발급됩니다. 크레딧은
            워터멜론 매거진 발행 요청과 온사이드 연계 서비스 이용에 사용할 수 있습니다.
          </p>
          <div className="mt-6 flex max-w-3xl flex-wrap gap-2">
            {heroBadges.map((badge) => (
              <span
                key={badge}
                className="rounded-[8px] border-2 border-white/35 bg-white/12 px-3 py-2 text-xs font-black text-white"
              >
                {badge}
              </span>
            ))}
          </div>
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
              href="#request"
              className="inline-flex min-h-11 items-center rounded-[8px] border-2 border-white bg-white/10 px-5 py-3 text-sm font-black text-white transition hover:-translate-y-0.5 hover:bg-white hover:text-[#111111]"
            >
              발행 요청하기
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
            크레딧으로 워터멜론 매거진 발행 요청과 온사이드 연계 다양한 서비스를
            이용할 수 있습니다.
          </p>
        </section>

        <div id="request" className="mt-8 scroll-mt-28">
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
