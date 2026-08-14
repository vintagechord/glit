import { englishStatusDashboardTabs } from "@/components/dashboard/dashboard-shell";
import { DashboardArtistDetailPageView } from "@/app/dashboard/artists/[id]/page";

export { metadata } from "@/app/dashboard/artists/[id]/page";

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
