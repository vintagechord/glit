import { LegalPage } from "@/components/site/legal-page";

export const metadata = { title: "개인정보처리방침" };

export default function PrivacyPage() {
  return <LegalPage policy="privacy" />;
}
