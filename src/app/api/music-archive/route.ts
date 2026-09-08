import { after } from "next/server";
import { z } from "zod";
import { authorizeArchiveRequest, archiveJson, archiveError, readArchiveJson, ArchiveError } from "@/lib/music-archive/http";
import { getArchiveOverview, getArchiveDetail, searchOwnedSubmissions, mutateArchive, searchArchiveArtists, getArchiveAdmin, getArchiveAdminDetail } from "@/lib/music-archive/service";
import { memberArchiveResponse } from "@/lib/music-archive/member-view";
import { runArchiveBatch } from "@/lib/music-archive/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: Request) {
  try {
    const { user, supabase } = await authorizeArchiveRequest(request);
    const params = new URL(request.url).searchParams;
    if (["admin", "admin-library"].includes(params.get("action") ?? "")) {
      const { data } = await supabase.rpc("is_admin");
      if (data !== true) throw new ArchiveError("관리자 권한이 필요합니다.", 403, "FORBIDDEN");
      return archiveJson(params.get("action") === "admin-library" ? await getArchiveAdminDetail(z.uuid().parse(params.get("libraryId"))) : await getArchiveAdmin(params.get("q") ?? "", Number(params.get("page") ?? 0)));
    }
    if (params.get("action") === "search") return archiveJson(await searchArchiveArtists(user.id, params));
    if (params.get("action") === "submissions") return archiveJson(await searchOwnedSubmissions(user.id, params.get("q") ?? "", Number(params.get("page") ?? 0)));
    if (params.has("libraryId")) {
      const detail = await getArchiveDetail(user.id, z.uuid().parse(params.get("libraryId")));
      if (detail.jobs.some(job => ["queued", "running"].includes(job.status))) {
        after(async () => { await runArchiveBatch(detail.library.id).catch(() => undefined); });
      }
      return archiveJson(memberArchiveResponse(detail));
    }
    return archiveJson(memberArchiveResponse(await getArchiveOverview(user.id, Number(params.get("page") ?? 0))));
  } catch (error) { return archiveError(error); }
}

export async function POST(request: Request) {
  try {
    const { user, supabase } = await authorizeArchiveRequest(request, true);
    const input = await readArchiveJson(request);
    const action = z.object({ action: z.string() }).parse(input).action;
    let isAdmin = false;
    if (action.startsWith("admin-")) {
      const { data } = await supabase.rpc("is_admin");
      if (data !== true) throw new ArchiveError("관리자 권한이 필요합니다.", 403, "FORBIDDEN");
      isAdmin = true;
    }
    const result = await mutateArchive(user.id, input, isAdmin);
    if (result.runLibraryId) {
      const libraryId = result.runLibraryId;
      after(async () => { await runArchiveBatch(libraryId).catch(() => undefined); });
    }
    return archiveJson(isAdmin ? result : memberArchiveResponse(result), result.job ? 202 : 200);
  } catch (error) { return archiveError(error); }
}
