type ArtistDetailDebugPageProps = {
  params:
    | Promise<{ [key: string]: string | string[] | undefined }>
    | { [key: string]: string | string[] | undefined };
  searchParams?:
    | Promise<{ [key: string]: string | string[] | undefined }>
    | { [key: string]: string | string[] | undefined };
};

export default async function DashboardArtistDetailDebugPage({
  params,
  searchParams,
}: ArtistDetailDebugPageProps) {
  const resolvedParams = await Promise.resolve(params);
  const resolvedSearchParams = await Promise.resolve(searchParams ?? {});

  return (
    <main style={{ padding: 24 }}>
      <h1>Artist Debug Page</h1>
      <h2>params</h2>
      <pre>{JSON.stringify(resolvedParams, null, 2)}</pre>
      <h2>searchParams</h2>
      <pre>{JSON.stringify(resolvedSearchParams, null, 2)}</pre>
    </main>
  );
}
