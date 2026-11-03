import Link from "next/link";
import { redirect } from "next/navigation";
import { getArchiveReviewEntry } from "@/lib/music-archive/review-entry";
import { AlbumIntroPanel } from "@/features/submissions/album-intro-panel";
import { AlbumWizard } from "@/features/submissions/album-wizard";
import { getPublicAlbumCatalog } from "@/lib/public-catalog";
import { createServerSupabase } from "@/lib/supabase/server";
import { getServerSessionUser } from "@/lib/supabase/server-user";
import { loadMemberApplicant } from "@/lib/member-applicant";

export const albumPreparationChecklist = [
  "WAV 음원 또는 전체 음원 ZIP",
  "앨범명, 아티스트명, 발매일, 장르, 유통사, 제작사",
  "트랙별 제목, 작·편곡자, 작사가, 전체 가사",
  "반복 후렴, 나레이션, 코러스 포함 전체 가사",
  "외국어 가사가 있는 경우 번역 가사",
  "실제 발매 앨범과 동일한 트랙 순서와 INST 포함 여부",
];

/** Server-rendered album application, used for the member flow from My Music (/dashboard/new/album/archive). */
export async function AlbumSubmissionPageView({ searchParams, localePrefix = "" }: { searchParams?: Promise<Record<string, string | string[] | undefined>>; localePrefix?: "" | "/en" }) {
  const query = await searchParams ?? {};
  const scalar = (key: string) => typeof query[key] === "string" ? query[key] as string : undefined;
  const archiveContext = scalar("archiveLibrary") ? { libraryId: scalar("archiveLibrary")!, releaseId: scalar("archiveRelease") ?? "", trackId: scalar("archiveTrack") } : null;
  const supabase = await createServerSupabase();
  const profanityFilterV2Enabled = process.env.PROFANITY_FILTER_V2 !== "false";
  const [user, { packages, albumDiscountPercent, profanityTerms }] = await Promise.all([
    getServerSessionUser(supabase),
    getPublicAlbumCatalog(),
  ]);

  if (archiveContext && !user) redirect(`${localePrefix}/login?next=${encodeURIComponent(`${localePrefix}/dashboard/new/album/archive?${new URLSearchParams(Object.entries(query).filter((entry): entry is [string, string] => typeof entry[1] === "string"))}`)}`);
  const archiveResult = archiveContext && user ? await getArchiveReviewEntry(user.id, archiveContext).then(entry => ({ entry, error: null })).catch((error: Error) => ({ entry: null, error: error.message })) : null;
  // Server-rendered copy: the English language pack only runs after hydration.
  const isEnglish = localePrefix === "/en";
  if (archiveResult?.error) return <div className="mx-auto max-w-3xl px-6 py-12"><p>{archiveResult.error}</p><Link href={`${localePrefix}/mypage/music`} className="mt-5 inline-block underline">{isEnglish ? "Return to My Music" : "내 음악 관리로 돌아가기"}</Link></div>;
  const initialApplicant = user ? await loadMemberApplicant(supabase, user) : undefined;
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 text-[15px] leading-relaxed sm:px-6 sm:py-12 sm:text-base">
      {archiveResult?.entry ? <div><h1 className="text-2xl font-black">{isEnglish ? "Apply for a Review" : "심의 신청"}</h1><p className="mt-2 text-sm text-muted-foreground">{isEnglish ? "Attach your audio files and proceed to payment." : "음원을 첨부하고 결제를 진행해주세요."}</p></div> : <AlbumIntroPanel preparationChecklist={albumPreparationChecklist} />}

      <div className="mt-8">
        <AlbumWizard
          packages={packages}
          initialArchiveEntry={archiveResult?.entry ?? undefined}
          initialApplicant={initialApplicant}
          userId={user?.id ?? null}
          userEmail={user?.email ?? null}
          profanityTerms={profanityTerms}
          profanityFilterV2Enabled={profanityFilterV2Enabled}
          albumDiscountPercent={albumDiscountPercent}
        />
      </div>
    </div>
  );
}
