import { pageMetadata, SITE_DESCRIPTION_EN } from "@/lib/seo";

export const dynamic = "force-dynamic";

export { default } from "@/app/page";

export const metadata = pageMetadata({
  locale: "en",
  title: "Onside | Korean Album & Music Video Review Submission Online",
  absoluteTitle: true,
  description: SITE_DESCRIPTION_EN,
  path: "/",
  enPath: "/en",
});
