import { SubmissionDetailPageView, type SubmissionDetailPageProps } from "./view";

export const metadata = {
  title: "심의 상세",
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function SubmissionDetailPage(props: SubmissionDetailPageProps) {
  return SubmissionDetailPageView(props);
}
