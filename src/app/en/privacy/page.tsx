import { LegalPage } from "@/components/site/legal-page";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  locale: "en",
  title: "Privacy Policy",
  description: "How Onside collects, uses, entrusts, transfers and retains personal information, and your rights.",
  path: "/privacy",
  enPath: "/en/privacy",
});

export default function EnglishPrivacyPage() {
  return <LegalPage policy="privacy" english />;
}
