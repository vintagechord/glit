import { buildLlmsText } from "@/lib/llms-text";
import { loadAlbumPackages } from "@/lib/review-guide-pricing";
import { getBaseUrl } from "@/lib/url";

// A Markdown summary for AI assistants (llms.txt convention). Rebuilt hourly
// with the public package catalog, like the guides it summarizes.
export const revalidate = 3600;

export async function GET() {
  const packages = await loadAlbumPackages();
  return new Response(buildLlmsText({ origin: getBaseUrl(), packages }), {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400" },
  });
}
