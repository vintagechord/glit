import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { archiveDatabaseError } from "./http";
import { matchArchiveReviews } from "./reviews";
import { validateArchiveData, type ArchiveContributor, type ArchiveData } from "./model";

export type CreditSubmission = {
  id: string; status: string; melon_url?: string | null; archive_review_context?: unknown;
  album_tracks: { id: string; track_no: number; track_title?: string | null; track_title_kr?: string | null; track_title_en?: string | null; composer?: string | null; lyricist?: string | null; arranger?: string | null }[];
};
const normalize = (value: string) => value.normalize("NFKC").trim().toLocaleLowerCase();
const hash = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 24);
const roleLabels = { lyrics: "작사", composition: "작곡", arrangement: "편곡" };

/** Exact owner-scoped album identity/explicit links first, then unambiguous track identity. */
export function mergeSubmissionCredits(input: ArchiveData, submissions: CreditSubmission[], libraryId: string): ArchiveData {
  const data = validateArchiveData(input);
  const scopes = matchArchiveReviews(data, submissions, libraryId);
  for (const scope of scopes) {
    const submission = submissions.find(row => row.id === scope.submissionId)!;
    for (const track of data.tracks.filter(row => row.releaseId === scope.releaseId && !row.excluded && !row.mergedInto && (!scope.trackIds.length || scope.trackIds.includes(row.id)))) {
      const link = data.reviewLinks.find(row => row.trackId === track.id && row.submissionId === submission.id && row.submissionTrackId);
      const candidates = submission.album_tracks.filter(row => link ? row.id === link.submissionTrackId : row.track_no === track.trackNumber && [row.track_title, row.track_title_kr, row.track_title_en].some(title => title && normalize(title) === normalize(track.title)));
      if (candidates.length !== 1) continue;
      const row = candidates[0];
      const contributors: ArchiveContributor[] = ([['lyrics', row.lyricist], ['composition', row.composer], ['arrangement', row.arranger]] as const).flatMap(([role, value]) => (value ?? "").split(/[,;\n]/).map(name => name.trim()).filter(Boolean).map(name => ({ name: name.slice(0, 500), role }))).slice(0, 100);
      if (!contributors.length) continue;
      const recordingId = track.recordingId ?? `archive-recording:${hash(track.id)}`;
      let recording = data.recordings.find(item => item.id === recordingId);
      if (!recording) { recording = { id: recordingId, title: track.title, workIds: [] }; data.recordings.push(recording); track.recordingId = recordingId; }
      const workId = `onside-work:${hash(`${submission.id}:${row.id}`)}`;
      // Member corrections and other linked work credits have precedence.
      if (recording.workIds.some(id => { const work = data.works.find(item => item.id === id); return work?.userEdited || (work?.contributors?.length && id !== workId); })) continue;
      const work = data.works.find(item => item.id === workId);
      if (work?.userEdited) continue;
      const fields = { contributors, writers: contributors.map(item => `${roleLabels[item.role]}: ${item.name}`).join(" · ").slice(0, 500) };
      if (work) Object.assign(work, fields);
      else data.works.push({ id: workId, title: track.title, institutionNumbers: [], ...fields });
      if (!recording.workIds.includes(workId)) recording.workIds.push(workId);
    }
  }
  return validateArchiveData(data);
}

export async function getOwnedCreditSubmissions(owner: string) {
  const submissions: CreditSubmission[] = [];
  for (let offset = 0; ; offset += 1000) {
    const result = await createAdminClient().from("submissions").select("id,status,melon_url,archive_review_context,album_tracks(id,track_no,track_title,track_title_kr,track_title_en,composer,lyricist,arranger)").eq("user_id", owner).eq("type", "ALBUM").is("user_deleted_at", null).not("status", "in", "(DRAFT,PRE_REVIEW,CANCELLED)").order("updated_at", { ascending: false }).order("id").range(offset, offset + 999);
    archiveDatabaseError(result.error);
    submissions.push(...(result.data ?? []));
    if (!result.data || result.data.length < 1000) break;
  }
  return submissions;
}

export async function importOwnedSubmissionCredits(owner: string, data: ArchiveData, libraryId: string) {
  return mergeSubmissionCredits(data, await getOwnedCreditSubmissions(owner), libraryId);
}
