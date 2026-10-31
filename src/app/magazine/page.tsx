import { MagazinePageView, type MagazinePageSearchParams } from "@/features/magazine/magazine-page-view";
import { pageMetadata } from "@/lib/seo";

export const dynamic = "force-dynamic";

export const metadata = pageMetadata({
  title: "매거진 발행 요청 · 크레딧",
  description: "음반 심의 결제 완료 건으로 받는 온사이드 크레딧을 확인하고 매거진 발행을 요청하세요.",
  path: "/magazine",
  enPath: "/en/magazine",
});

export default async function MagazinePage({
  searchParams,
}: {
  searchParams?: Promise<MagazinePageSearchParams>;
}) {
  return MagazinePageView({ searchParams });
}
