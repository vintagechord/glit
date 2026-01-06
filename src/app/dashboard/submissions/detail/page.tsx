import { redirect } from "next/navigation";

export default function DashboardSubmissionDetailRedirect({
  searchParams,
}: {
  searchParams: { id?: string | string[] };
}) {
  const searchId = Array.isArray(searchParams.id)
    ? searchParams.id?.[0] ?? ""
    : searchParams.id ?? "";

  if (!searchId) {
    redirect("/dashboard/history");
  }

  redirect(`/dashboard/submissions/${searchId}`);
}
