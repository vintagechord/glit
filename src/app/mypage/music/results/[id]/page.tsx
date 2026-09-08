import SubmissionDetailPage from "@/app/dashboard/submissions/[id]/page";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata = { title: "심의 결과" };

export default function ArchiveSubmissionResultPage({ params }: { params: Promise<{ id: string }> }) {
  return <SubmissionDetailPage params={params} searchParams={Promise.resolve({ view: "archive-result" })} />;
}
