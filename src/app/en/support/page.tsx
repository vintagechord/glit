import { SupportPageView } from "@/features/support/support-page-view";
import { pageMetadata } from "@/lib/seo";

export default function EnglishSupportPage() {
  return <SupportPageView localePrefix="/en" />;
}

export const metadata = pageMetadata({
  locale: "en",
  title: "Support",
  description: "Contact Onside about review applications, payments and results.",
  path: "/support",
  enPath: "/en/support",
});
