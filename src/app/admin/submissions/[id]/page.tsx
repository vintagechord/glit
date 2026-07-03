import AdminSubmissionDetailPage from "../detail/page";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata = {
  title: "접수 상세 관리",
};

type AdminSubmissionDetailByIdSearchParams = {
  saved?: string | string[];
  savedError?: string | string[];
  savedWarning?: string | string[];
};

export default async function AdminSubmissionDetailById({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }> | { id: string };
  searchParams?:
    | Promise<AdminSubmissionDetailByIdSearchParams>
    | AdminSubmissionDetailByIdSearchParams;
}) {
  const resolvedParams = await Promise.resolve(params);
  const resolvedSearchParams = await Promise.resolve(searchParams ?? {});
  const saved = Array.isArray(resolvedSearchParams.saved)
    ? resolvedSearchParams.saved[0]
    : resolvedSearchParams.saved;
  const savedError = Array.isArray(resolvedSearchParams.savedError)
    ? resolvedSearchParams.savedError[0]
    : resolvedSearchParams.savedError;
  const savedWarning = Array.isArray(resolvedSearchParams.savedWarning)
    ? resolvedSearchParams.savedWarning[0]
    : resolvedSearchParams.savedWarning;

  return await AdminSubmissionDetailPage({
    params: resolvedParams,
    searchParams: {
      id: resolvedParams.id,
      saved,
      savedError,
      savedWarning,
    },
  });
}
