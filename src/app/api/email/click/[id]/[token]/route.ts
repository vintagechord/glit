import { classifyActivityClient, isValidEmailOpenToken, recordEmailActivityAfterResponse, safeTrackedTarget } from "@/lib/customer-result-tracking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A link in customer mail. Always forwards to the Onside page it names
 * (never another site); only a correctly signed link is recorded. */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; token: string }> },
) {
  const { id, token } = await context.params;
  const target = safeTrackedTarget(new URL(request.url).searchParams.get("to"));
  if (isValidEmailOpenToken(id, token.toLowerCase())) {
    recordEmailActivityAfterResponse(id.toLowerCase(), "mail_click", classifyActivityClient(request.headers.get("user-agent")));
  }
  return new Response(null, {
    status: 302,
    headers: {
      Location: target,
      "Cache-Control": "no-store, private",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex",
    },
  });
}
