import { SubmissionDetailPageView, type SubmissionDetailPageProps } from "@/app/dashboard/submissions/[id]/view";

export { metadata } from "@/app/dashboard/submissions/[id]/page";

// Route config must be declared directly; Turbopack cannot evaluate re-exports.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function EnglishSubmissionDetailPage(props: SubmissionDetailPageProps) {
  return SubmissionDetailPageView({ ...props, localePrefix: "/en" });
}
