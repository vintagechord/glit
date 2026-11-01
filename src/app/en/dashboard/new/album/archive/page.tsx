import { AlbumSubmissionPageView } from "@/app/dashboard/new/album/view";
import { pageMetadata } from "@/lib/seo";

// A signed-in member applying for a release from My Music: verified and
// rendered per request, unlike the static album application page.
export const metadata = pageMetadata({
  locale: "en",
  title: "Album Review Application",
  description: "Apply for an album review from your music archive.",
  path: "/dashboard/new/album",
  enPath: "/en/dashboard/new/album",
  noindex: true,
});

export default function EnglishArchiveAlbumSubmissionPage(props: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  return AlbumSubmissionPageView({ ...props, localePrefix: "/en" });
}
