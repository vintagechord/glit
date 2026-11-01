import { AlbumApplication } from "@/features/submissions/album-application";
import { AlbumIntroPanel } from "@/features/submissions/album-intro-panel";
import { getPublicAlbumCatalog } from "@/lib/public-catalog";

import { albumPreparationChecklist } from "./view";

/**
 * The album application page as served from the CDN: the public catalog is
 * rendered in, and the applicant (guest or member) is resolved in the browser.
 */
export async function AlbumApplicationPageView() {
  const profanityFilterV2Enabled = process.env.PROFANITY_FILTER_V2 !== "false";
  const { packages, albumDiscountPercent, profanityTerms } = await getPublicAlbumCatalog();
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 text-[15px] leading-relaxed sm:px-6 sm:py-12 sm:text-base">
      <AlbumIntroPanel preparationChecklist={albumPreparationChecklist} />
      <div className="mt-8">
        <AlbumApplication
          packages={packages}
          profanityTerms={profanityTerms}
          profanityFilterV2Enabled={profanityFilterV2Enabled}
          albumDiscountPercent={albumDiscountPercent}
        />
      </div>
    </div>
  );
}
