import { redirect } from "next/navigation";

type PageProps = {
  params: Promise<{ service: string }>;
  searchParams?: Promise<{ type?: string | string[] }>;
};

const toSingle = (value?: string | string[]) =>
  Array.isArray(value) ? value[0] ?? "" : value ?? "";

export default async function EnglishApplyServiceAliasPage({
  params,
  searchParams,
}: PageProps) {
  const { service } = await params;
  const resolvedSearchParams = (await searchParams) ?? {};

  if (service === "album") {
    redirect("/en/dashboard/new/album");
  }

  if (service === "mv") {
    const type = toSingle(resolvedSearchParams.type);
    redirect(
      type === "broadcast"
        ? "/en/dashboard/new/mv?type=broadcast"
        : "/en/dashboard/new/mv",
    );
  }

  redirect("/en/dashboard/new");
}
