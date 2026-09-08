import type { createAdminClient } from "@/lib/supabase/admin";
import { isStoredReleasedAlbumAudioFile } from "@/lib/submission-files";

/** Called after ownership checks and before any checkout/order mutation or provider request. */
export async function validateReleasedAlbumPaymentFiles(
  db: Pick<ReturnType<typeof createAdminClient>, "from">,
  submissionIds: string[],
): Promise<string | null> {
  if (!submissionIds.length) return null;
  const { data: albums, error: albumError } = await db.from("submissions")
    .select("id")
    .in("id", [...new Set(submissionIds)])
    .eq("type", "ALBUM")
    .eq("is_oneclick", true);
  if (albumError) return "음원 업로드 상태를 확인할 수 없습니다. 잠시 후 다시 시도해주세요.";
  if (!albums?.length) return null;
  const releasedIds = albums.map(album => String(album.id));
  const readyIds = new Set<string>();
  // Supabase caps result pages. A large album bundle must not lose later albums
  // simply because earlier submissions contain many individual WAV files.
  const pageSize = 500;
  for (let offset = 0; offset < 10_000; offset += pageSize) {
    const { data: files, error: fileError } = await db.from("submission_files")
      .select("submission_id, original_name, mime, status, file_path, object_key, size")
      .in("submission_id", releasedIds)
      .eq("kind", "AUDIO")
      .order("id")
      .range(offset, offset + pageSize - 1);
    if (fileError) return "음원 업로드 상태를 확인할 수 없습니다. 잠시 후 다시 시도해주세요.";
    for (const file of files ?? []) {
      if (isStoredReleasedAlbumAudioFile(file)) readyIds.add(String(file.submission_id));
    }
    if (releasedIds.every(id => readyIds.has(id))) return null;
    if ((files?.length ?? 0) < pageSize) break;
  }
  return "음원 파일(WAV 또는 ZIP)을 사이트에 업로드해주세요.";
}
