import { AlbumSubmissionPageView } from "@/app/dashboard/new/album/view";
import { pageMetadata } from "@/lib/seo";

// A signed-in member applying for a release from My Music: verified and
// rendered per request, unlike the static album application page.
export const metadata = pageMetadata({
  title: "음반 심의 신청",
  description: "내 음악 관리에 등록한 앨범으로 음반 심의를 신청합니다.",
  path: "/dashboard/new/album",
  enPath: "/en/dashboard/new/album",
  noindex: true,
});

export default function ArchiveAlbumSubmissionPage(props: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  return AlbumSubmissionPageView({ ...props });
}
