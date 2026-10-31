import { FormsPageView } from "@/features/support/forms-page-view";
import { pageMetadata } from "@/lib/seo";

export default function EnglishFormsPage() {
  return <FormsPageView localePrefix="/en" />;
}

export const metadata = pageMetadata({
  locale: "en",
  title: "Apply on the previous Onside site",
  description: "Go to the previous Onside application site to submit a review the old way.",
  path: "/forms",
  enPath: "/en/forms",
});
