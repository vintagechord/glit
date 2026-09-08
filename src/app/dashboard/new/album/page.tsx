import Link from "next/link";
import { redirect } from "next/navigation";
import { getArchiveReviewEntry } from "@/lib/music-archive/review-entry";
import { AlbumIntroPanel } from "@/features/submissions/album-intro-panel";
import { AlbumWizard } from "@/features/submissions/album-wizard";
import { getPublicAlbumCatalog } from "@/lib/public-catalog";
import { createServerSupabase } from "@/lib/supabase/server";
import { getServerSessionUser } from "@/lib/supabase/server-user";

export const metadata = {
  title: "음반 심의 접수",
};

const preparationChecklist = [
  "WAV 음원 또는 전체 음원 ZIP",
  "앨범명, 아티스트명, 발매일, 장르, 유통사, 제작사",
  "트랙별 제목, 작·편곡자, 작사가, 전체 가사",
  "반복 후렴, 나레이션, 코러스 포함 전체 가사",
  "외국어 가사가 있는 경우 번역 가사",
  "실제 발매 앨범과 동일한 트랙 순서와 INST 포함 여부",
];

export default async function AlbumSubmissionPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams ?? {};
  const scalar = (key: string) => typeof query[key] === "string" ? query[key] as string : undefined;
  const archiveContext = scalar("archiveLibrary") ? { libraryId: scalar("archiveLibrary")!, releaseId: scalar("archiveRelease") ?? "", trackId: scalar("archiveTrack") } : null;
  const supabase = await createServerSupabase();
  const profanityFilterV2Enabled = process.env.PROFANITY_FILTER_V2 !== "false";
  const [user, { packages, albumDiscountPercent, profanityTerms }] = await Promise.all([
    getServerSessionUser(supabase),
    getPublicAlbumCatalog(),
  ]);

  if (archiveContext && !user) redirect(`/login?next=${encodeURIComponent(`/dashboard/new/album?${new URLSearchParams(Object.entries(query).filter((entry): entry is [string, string] => typeof entry[1] === "string"))}`)}`);
  const archiveResult = archiveContext && user ? await getArchiveReviewEntry(user.id, archiveContext).then(entry => ({ entry, error: null })).catch((error: Error) => ({ entry: null, error: error.message })) : null;
  if (archiveResult?.error) return <div className="mx-auto max-w-3xl px-6 py-12"><p>{archiveResult.error}</p><Link href="/mypage/music" className="mt-5 inline-block underline">내 음악 관리로 돌아가기</Link></div>;
  const profile = archiveContext && user ? (await supabase.from("profiles").select("name,phone").eq("user_id", user.id).maybeSingle()).data : null;
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 text-[15px] leading-relaxed sm:px-6 sm:py-12 sm:text-base">
      {archiveResult?.entry ? <div><h1 className="text-2xl font-black">심의 신청</h1><p className="mt-2 text-sm text-muted-foreground">음원을 첨부하고 결제를 진행해주세요.</p></div> : <AlbumIntroPanel preparationChecklist={preparationChecklist} />}

      <div className="mt-8">
        <AlbumWizard
          packages={packages}
          initialArchiveEntry={archiveResult?.entry ?? undefined}
          initialApplicant={archiveResult?.entry ? { name: profile?.name ?? "", email: user?.email ?? "", phone: profile?.phone ?? "" } : undefined}
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
