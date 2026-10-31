import { AlbumSubmissionPageView } from "./view";
import { pageMetadata } from "@/lib/seo";
export const metadata = pageMetadata({
  title: "음반 심의 신청 · 앨범 심의 온라인 접수",
  description: "발매 전·후 앨범의 음반 심의를 온라인으로 신청하세요. KBS·MBC·SBS 등 방송국 3곳부터 15곳까지 선택할 수 있습니다.",
  path: "/dashboard/new/album",
  enPath: "/en/dashboard/new/album",
});
export default function AlbumSubmissionPage(props: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  return AlbumSubmissionPageView(props);
}
