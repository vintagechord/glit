import {
  MyPageCreditsPageView,
  type MyPageCreditsSearchParams,
} from "@/features/credits/credits-page-view";

export { metadata } from "@/app/mypage/credits/page";

export default async function EnglishMyPageCreditsPage({
  searchParams,
}: {
  searchParams?: Promise<MyPageCreditsSearchParams>;
}) {
  return MyPageCreditsPageView({ searchParams, localePrefix: "/en" });
}
