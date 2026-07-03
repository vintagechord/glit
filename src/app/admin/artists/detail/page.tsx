import { redirect } from "next/navigation";

type SearchParams = {
  id?: string | string[];
};

export default async function AdminArtistDetailRedirect({
  searchParams,
}: {
  searchParams?: Promise<SearchParams> | SearchParams;
}) {
  const resolvedSearchParams = await Promise.resolve(searchParams ?? {});
  const searchId = Array.isArray(resolvedSearchParams.id)
    ? resolvedSearchParams.id?.[0] ?? ""
    : resolvedSearchParams.id ?? "";

  if (!searchId) {
    redirect("/admin/artists");
  }

  redirect(`/admin/artists/${searchId}`);
}
