import { downloadReviewFile } from "@/lib/review-docs/download";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return downloadReviewFile(request, (await context.params).id, true);
}
