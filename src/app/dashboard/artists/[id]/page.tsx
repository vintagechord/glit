import { DashboardArtistDetailPageView } from "./view";

export const metadata = {
  title: "아티스트 상세",
};

export const dynamic = "force-dynamic";

export const revalidate = 0;

export default async function DashboardArtistDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return DashboardArtistDetailPageView({ params });
}
