import { TrackPageView, type TrackPageProps } from "@/features/track/track-page-view";

export const metadata = {
  title: "진행상황",
};

export default async function TrackPage({ searchParams }: TrackPageProps) {
  return TrackPageView({ searchParams });
}
