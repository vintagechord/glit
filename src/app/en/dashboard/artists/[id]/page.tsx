import { englishStatusDashboardTabs } from "@/components/dashboard/dashboard-shell";
import { DashboardArtistDetailPageView } from "@/app/dashboard/artists/[id]/view";

// Private member page: English tab title, never indexed (the Korean twin
// is disallowed in robots.txt).
export const metadata = {
  title: { absolute: "Artist Details | Onside" },
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function EnglishDashboardArtistDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return DashboardArtistDetailPageView({
    params,
    localePrefix: "/en",
    tabs: englishStatusDashboardTabs,
  });
}
