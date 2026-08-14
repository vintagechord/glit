import {
  MagazinePageView,
  type MagazinePageSearchParams,
} from "@/app/magazine/page";

export { metadata } from "@/app/magazine/page";

export const dynamic = "force-dynamic";

export default async function EnglishMagazinePage({
  searchParams,
}: {
  searchParams?: Promise<MagazinePageSearchParams>;
}) {
  return MagazinePageView({ searchParams, localePrefix: "/en" });
}
