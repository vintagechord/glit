import { LegalPage } from "@/components/site/legal-page";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "개인정보처리방침",
  description: "온사이드의 개인정보 수집·이용, 처리 위탁, 국외 이전, 보유 기간과 이용자 권리를 안내합니다.",
  path: "/privacy",
  enPath: "/en/privacy",
});

export default function PrivacyPage() {
  return <LegalPage policy="privacy" />;
}
