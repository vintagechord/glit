import { authorizeArchiveRequest, archiveJson, archiveError } from "@/lib/music-archive/http";
import { uploadArchiveEvidence, downloadArchiveEvidence, deleteArchiveEvidence } from "@/lib/music-archive/evidence";
import { buildAttachmentHeaders } from "@/lib/download-response";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
export async function POST(request: Request) {
  try { const { user } = await authorizeArchiveRequest(request, true); return archiveJson(await uploadArchiveEvidence(user.id, request), 201); }
  catch (error) { return archiveError(error); }
}
export async function GET(request: Request) {
  try {
    const { user } = await authorizeArchiveRequest(request);
    const { file, bytes } = await downloadArchiveEvidence(user.id, new URL(request.url).searchParams.get("id") ?? "");
    const headers = buildAttachmentHeaders({ filename: file.file_name, contentType: file.mime_type, contentLength: bytes.length });
    headers.set("X-Content-Type-Options", "nosniff"); headers.set("Content-Security-Policy", "sandbox");
    return new Response(new Uint8Array(bytes), { headers });
  } catch (error) { return archiveError(error); }
}
export async function DELETE(request: Request) {
  try { const { user } = await authorizeArchiveRequest(request, true); return archiveJson(await deleteArchiveEvidence(user.id, new URL(request.url).searchParams.get("id") ?? "")); }
  catch (error) { return archiveError(error); }
}
