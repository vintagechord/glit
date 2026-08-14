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
  returnTo?: string | string[];
};

const firstParam = (value?: string | string[]) =>
  Array.isArray(value) ? value[0] : value;

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
  const saved = firstParam(resolvedSearchParams.saved);
  const savedError = firstParam(resolvedSearchParams.savedError);
  const savedWarning = firstParam(resolvedSearchParams.savedWarning);
  const returnTo = firstParam(resolvedSearchParams.returnTo);

  return await AdminSubmissionDetailPage({
    params: resolvedParams,
    searchParams: {
      id: resolvedParams.id,
      saved,
      savedError,
      savedWarning,
      returnTo,
    },
  });
}
