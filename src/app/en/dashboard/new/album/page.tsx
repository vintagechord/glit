import { AlbumSubmissionPageView } from "@/app/dashboard/new/album/view";
import { pageMetadata } from "@/lib/seo";
export const metadata = pageMetadata({
  locale: "en",
  title: "Album Review Application",
  description: "Apply online for Korean broadcast album reviews with KBS, MBC, SBS and up to 15 stations.",
  path: "/dashboard/new/album",
  enPath: "/en/dashboard/new/album",
});
export default function EnglishAlbumSubmissionPage(props: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  return AlbumSubmissionPageView({ ...props, localePrefix: "/en" });
}
