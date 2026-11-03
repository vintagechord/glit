import SubmissionDetailPage from "@/app/dashboard/submissions/[id]/page";

export const metadata = {
  title: "심의 상세",
};

// Route config must be declared directly; Turbopack cannot evaluate re-exports.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default SubmissionDetailPage;
