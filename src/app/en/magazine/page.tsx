import {
  MagazinePageView,
  type MagazinePageSearchParams,
} from "@/features/magazine/magazine-page-view";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  locale: "en",
  title: "Magazine Requests and Credits",
  description: "Check Onside credits earned from paid album reviews and request a magazine feature.",
  path: "/magazine",
  enPath: "/en/magazine",
});

export const dynamic = "force-dynamic";

export default async function EnglishMagazinePage({
  searchParams,
}: {
  searchParams?: Promise<MagazinePageSearchParams>;
}) {
  return MagazinePageView({ searchParams, localePrefix: "/en" });
}
