import { TrackPageView, type TrackPageProps } from "@/features/track/track-page-view";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "심의 결과 조회 · 진행상황 확인",
  description: "조회 코드로 음반 심의·뮤직비디오 심의 진행 상황과 방송국별 결과를 확인하세요.",
  path: "/track",
  enPath: "/en/track",
});

export default async function TrackPage({ searchParams }: TrackPageProps) {
  return TrackPageView({ searchParams });
}
