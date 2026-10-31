import { TrackPageView } from "@/features/track/track-page-view";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  locale: "en",
  title: "Track Your Review",
  description: "Use your lookup code to check album and music video review progress and results by broadcaster.",
  path: "/track",
  enPath: "/en/track",
});

type TrackPageProps = {
  searchParams?: Promise<{ mode?: string | string[] }>;
};

export default async function EnglishTrackPage({ searchParams }: TrackPageProps) {
  return TrackPageView({ searchParams, dashboardPath: "/en/dashboard" });
}
