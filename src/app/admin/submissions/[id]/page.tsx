import AdminSubmissionDetailPage from "../detail/page";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata = {
  title: "접수 상세 관리",
};

export default function AdminSubmissionDetailById({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: {
    saved?: string | string[];
    savedError?: string | string[];
    savedWarning?: string | string[];
  };
}) {
  const saved = Array.isArray(searchParams?.saved)
    ? searchParams?.saved[0]
    : searchParams?.saved;
  const savedError = Array.isArray(searchParams?.savedError)
    ? searchParams?.savedError[0]
    : searchParams?.savedError;
  const savedWarning = Array.isArray(searchParams?.savedWarning)
    ? searchParams?.savedWarning[0]
    : searchParams?.savedWarning;

  return AdminSubmissionDetailPage({
    params,
    searchParams: {
      id: params.id,
      saved,
      savedError,
      savedWarning,
    },
  });
}
