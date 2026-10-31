import { SupportPageView } from "@/features/support/support-page-view";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "고객센터 · 심의 신청·결제·결과 문의",
  description: "음반 심의·뮤직비디오 심의 신청, 결제, 결과 확인에 관한 문의는 온사이드 고객센터로 연락하세요.",
  path: "/support",
  enPath: "/en/support",
});

export default function SupportPage() {
  return <SupportPageView />;
}
