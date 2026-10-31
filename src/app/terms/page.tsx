import { LegalPage } from "@/components/site/legal-page";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "이용약관",
  description: "온사이드 심의 서비스 이용약관입니다.",
  path: "/terms",
  enPath: "/en/terms",
});

export default function TermsPage() {
  return <LegalPage policy="terms" />;
}
