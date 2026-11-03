import { SubmissionDetailPageView, type SubmissionDetailPageProps } from "@/app/dashboard/submissions/[id]/view";

// Private member page: English tab title, never indexed (the Korean twin
// is disallowed in robots.txt).
export const metadata = {
  title: { absolute: "Review Detail | Onside" },
  robots: { index: false, follow: false },
};

// Route config must be declared directly; Turbopack cannot evaluate re-exports.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function EnglishSubmissionDetailPage(props: SubmissionDetailPageProps) {
  return SubmissionDetailPageView({ ...props, localePrefix: "/en" });
}
