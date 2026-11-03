import {
  MyPageCreditsPageView,
  type MyPageCreditsSearchParams,
} from "@/features/credits/credits-page-view";

// Private member page: English tab title, never indexed (the Korean twin
// is disallowed in robots.txt).
export const metadata = {
  title: { absolute: "My Page - My Credits | Onside" },
  robots: { index: false, follow: false },
};

export default async function EnglishMyPageCreditsPage({
  searchParams,
}: {
  searchParams?: Promise<MyPageCreditsSearchParams>;
}) {
  return MyPageCreditsPageView({ searchParams, localePrefix: "/en" });
}
