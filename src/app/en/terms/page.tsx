import { LegalPage } from "@/components/site/legal-page";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  locale: "en",
  title: "Terms of Use",
  description: "Onside review service terms of use.",
  path: "/terms",
  enPath: "/en/terms",
});

export default function EnglishTermsPage() {
  return <LegalPage policy="terms" english />;
}
