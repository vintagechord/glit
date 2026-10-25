import { AlbumSubmissionPageView } from "@/app/dashboard/new/album/view";
export const metadata = { title: "Album Review Application" };
export default function EnglishAlbumSubmissionPage(props: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  return AlbumSubmissionPageView({ ...props, localePrefix: "/en" });
}
