import { SubmissionDetailPageView, type SubmissionDetailPageProps } from "@/app/dashboard/submissions/[id]/view";

export { metadata, dynamic, revalidate } from "@/app/dashboard/submissions/[id]/page";

export default function EnglishSubmissionDetailPage(props: SubmissionDetailPageProps) {
  return SubmissionDetailPageView({ ...props, localePrefix: "/en" });
}
