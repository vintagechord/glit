import { LegalPage } from "@/components/site/legal-page";

export const metadata = { title: "Privacy Policy" };

export default function EnglishPrivacyPage() {
  return <LegalPage policy="privacy" english />;
}
