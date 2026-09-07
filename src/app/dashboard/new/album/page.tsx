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

export default async function AlbumSubmissionPage() {
  const supabase = await createServerSupabase();
  const profanityFilterV2Enabled = process.env.PROFANITY_FILTER_V2 !== "false";
  const [user, { packages, albumDiscountPercent, profanityTerms }] = await Promise.all([
    getServerSessionUser(supabase),
    getPublicAlbumCatalog(),
  ]);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 text-[15px] leading-relaxed sm:px-6 sm:py-12 sm:text-base">
      <AlbumIntroPanel
        preparationChecklist={preparationChecklist}
      />

      <div className="mt-8">
        <AlbumWizard
          packages={packages}
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
