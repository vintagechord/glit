import { redirect } from "next/navigation";

type SearchParams = {
  id?: string | string[];
};

export default async function AdminArtistDetailRedirect({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const resolvedSearchParams: SearchParams = (await searchParams) ?? {};
  const searchId = Array.isArray(resolvedSearchParams.id)
    ? resolvedSearchParams.id?.[0] ?? ""
    : resolvedSearchParams.id ?? "";

  if (!searchId) {
    redirect("/admin/artists");
  }

  redirect(`/admin/artists/${searchId}`);
}
