import { isValidEmailOpenToken, recordEmailOpenAfterResponse, TRANSPARENT_GIF } from "@/lib/customer-result-tracking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The open-tracking image in customer mail. Always answers with the image;
 * only a correctly signed request for a delivered mail is recorded. */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; file: string }> },
) {
  const { id, file } = await context.params;
  const token = file.toLowerCase().endsWith(".gif") ? file.slice(0, -4) : "";
  if (isValidEmailOpenToken(id, token)) recordEmailOpenAfterResponse(id.toLowerCase());
  return new Response(new Uint8Array(TRANSPARENT_GIF), {
    headers: {
      "Content-Type": "image/gif",
      "Content-Length": String(TRANSPARENT_GIF.length),
      "Cache-Control": "no-store, no-cache, must-revalidate, private",
      "X-Robots-Tag": "noindex",
    },
  });
}
