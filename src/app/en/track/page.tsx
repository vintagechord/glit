import { TrackPageView } from "@/features/track/track-page-view";

export { metadata } from "@/app/track/page";

type TrackPageProps = {
  searchParams?: Promise<{ mode?: string | string[] }>;
};

export default async function EnglishTrackPage({ searchParams }: TrackPageProps) {
  return TrackPageView({ searchParams, dashboardPath: "/en/dashboard" });
}
