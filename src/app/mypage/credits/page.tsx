import { MyPageCreditsPageView, type MyPageCreditsSearchParams } from "@/features/credits/credits-page-view";

export const metadata = {
  title: "마이페이지 - 나의 크레딧",
};

export const dynamic = "force-dynamic";

export default async function MyPageCreditsPage({
  searchParams,
}: {
  searchParams?: Promise<MyPageCreditsSearchParams>;
}) {
  return MyPageCreditsPageView({ searchParams });
}
