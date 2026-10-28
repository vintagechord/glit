import { LegalPage } from "@/components/site/legal-page";

export const metadata = { title: "이용약관" };

export default function TermsPage() {
  return <LegalPage policy="terms" />;
}
