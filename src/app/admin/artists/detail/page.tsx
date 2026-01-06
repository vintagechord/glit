import { redirect } from "next/navigation";

export default function AdminArtistDetailRedirect({
  searchParams,
}: {
  searchParams: { id?: string | string[] };
}) {
  const searchId = Array.isArray(searchParams.id)
    ? searchParams.id?.[0] ?? ""
    : searchParams.id ?? "";

  if (!searchId) {
    redirect("/admin/artists");
  }

  redirect(`/admin/artists/${searchId}`);
}
