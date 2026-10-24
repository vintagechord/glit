import { MagazinePageView, type MagazinePageSearchParams } from "@/features/magazine/magazine-page-view";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "크레딧",
  description:
    "음반심의 결제 완료 건으로 발급되는 온사이드 크레딧을 확인하고 사용하세요.",
};

export default async function MagazinePage({
  searchParams,
}: {
  searchParams?: Promise<MagazinePageSearchParams>;
}) {
  return MagazinePageView({ searchParams });
}
