type ArtistDetailDebugPageProps = {
  params: { [key: string]: string | string[] | undefined };
  searchParams?: { [key: string]: string | string[] | undefined };
};

export default function DashboardArtistDetailDebugPage({
  params,
  searchParams,
}: ArtistDetailDebugPageProps) {
  return (
    <main style={{ padding: 24 }}>
      <h1>Artist Debug Page</h1>
      <h2>params</h2>
      <pre>{JSON.stringify(params, null, 2)}</pre>
      <h2>searchParams</h2>
      <pre>{JSON.stringify(searchParams ?? {}, null, 2)}</pre>
    </main>
  );
}
