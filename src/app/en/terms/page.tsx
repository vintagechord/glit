import { LegalPage } from "@/components/site/legal-page";

export const metadata = { title: "Terms of Use" };

export default function EnglishTermsPage() {
  return <LegalPage policy="terms" english />;
}
