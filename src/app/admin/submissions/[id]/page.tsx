import AdminSubmissionDetailPage from "../detail/page";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata = {
  title: "접수 상세 관리",
};

export default function AdminSubmissionDetailById({
  params,
}: {
  params: { id: string };
}) {
  return AdminSubmissionDetailPage({
    params,
    searchParams: { id: params.id },
  });
}
