import {
  MyPageCreditsPageView,
  type MyPageCreditsSearchParams,
} from "@/app/mypage/credits/page";

export { metadata } from "@/app/mypage/credits/page";

export default async function EnglishMyPageCreditsPage({
  searchParams,
}: {
  searchParams?: Promise<MyPageCreditsSearchParams>;
}) {
  return MyPageCreditsPageView({ searchParams, localePrefix: "/en" });
}
