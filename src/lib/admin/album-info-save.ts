import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

/** The application-form fields of an album submission that staff tools may
 * fill in after the customer's intake: the review desk after a manual case was
 * registered online, the admin detail page, and the Melon/Genie hydration of a
 * released-album (URL) request. Station results and payments are never touched. */
const optionalText = (max: number) =>
  z.string().trim().max(max).nullish().transform((value) => value || null);
const isoDate = z.string().trim().nullish()
  .transform((value) => value || null)
  .refine((value) => value === null || /^\d{4}-\d{2}-\d{2}$/.test(value), { message: "release date must be YYYY-MM-DD" });

export const albumInfoSubmissionSchema = z.object({
  title: optionalText(200),
  artistName: optionalText(200),
  artistNameKr: optionalText(200),
  artistNameEn: optionalText(200),
  releaseDate: isoDate,
  genre: optionalText(100),
  distributor: optionalText(200),
  productionCompany: optionalText(200),
  previousRelease: optionalText(2000),
  artistType: z.union([z.enum(["SOLO", "GROUP"]), z.literal("")]).nullish().transform((value) => value || null),
  artistGender: optionalText(40),
  artistMembers: optionalText(1000),
});
export const albumInfoTrackSchema = z.object({
  trackNo: z.number().int().min(1).max(999),
  trackTitle: z.string().trim().min(1).max(300),
  performer: optionalText(300),
  featuring: optionalText(300),
  composer: optionalText(300),
  lyricist: optionalText(300),
  arranger: optionalText(300),
  lyrics: optionalText(30000),
  translatedLyrics: optionalText(30000),
  notes: optionalText(1000),
  isTitle: z.boolean().optional(),
  broadcastSelected: z.boolean().optional(),
});
export const albumInfoSchema = z.object({
  submission: albumInfoSubmissionSchema.prefault({}),
  tracks: z.array(albumInfoTrackSchema).max(100).prefault([]),
});
export type AlbumInfoInput = z.infer<typeof albumInfoSchema>;

export type AlbumInfoSaveResult =
  | { ok: true; changed: boolean; updatedFields: string[]; updatedTracks: number; insertedTracks: number }
  | { ok: false; errorCode: "NOT_FOUND" | "INVALID_TYPE" | "SAVE_FAILED"; error: string };

const submissionColumns = {
  title: "title",
  artistName: "artist_name",
  artistNameKr: "artist_name_kr",
  artistNameEn: "artist_name_en",
  releaseDate: "release_date",
  genre: "genre",
  distributor: "distributor",
  productionCompany: "production_company",
  previousRelease: "previous_release",
  artistType: "artist_type",
  artistGender: "artist_gender",
  artistMembers: "artist_members",
} as const;
const trackColumns = {
  trackTitle: "track_title",
  performer: "performer",
  featuring: "featuring",
  composer: "composer",
  lyricist: "lyricist",
  arranger: "arranger",
  lyrics: "lyrics",
  translatedLyrics: "translated_lyrics",
  notes: "notes",
} as const;

const hasText = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const sameText = (a: unknown, b: string) => (typeof a === "string" ? a.trim() : "") === b.trim();

type ExistingTrack = Record<string, unknown> & { id: string; track_no: number | null; is_title: boolean | null; title_role: string | null; broadcast_selected: boolean | null };

export async function saveManagedAlbumInfo(
  db: SupabaseClient,
  options: {
    submissionId: string;
    actorUserId: string | null;
    input: AlbumInfoInput;
    /** "fill-empty" only completes blank fields (catalog hydration); "overwrite" applies every provided value. */
    mode: "overwrite" | "fill-empty";
    /** Shown in the submission event, e.g. "심의 데스크". */
    source: string;
  },
): Promise<AlbumInfoSaveResult> {
  const { submissionId, mode } = options;
  const { data: submission, error } = await db
    .from("submissions")
    .select("id, type, title, artist_name, artist_name_kr, artist_name_en, release_date, genre, distributor, production_company, previous_release, artist_type, artist_gender, artist_members")
    .eq("id", submissionId)
    .maybeSingle();
  if (error) return { ok: false, errorCode: "SAVE_FAILED", error: "접수 정보를 확인하지 못했습니다." };
  if (!submission) return { ok: false, errorCode: "NOT_FOUND", error: "접수를 찾을 수 없습니다." };
  if (submission.type !== "ALBUM") return { ok: false, errorCode: "INVALID_TYPE", error: "음반 접수에만 신청서 정보를 반영할 수 있습니다." };

  const current = submission as Record<string, unknown>;
  const update: Record<string, string> = {};
  for (const [key, column] of Object.entries(submissionColumns) as Array<[keyof typeof submissionColumns, string]>) {
    const value = options.input.submission[key];
    if (!hasText(value)) continue;
    if (mode === "fill-empty" && hasText(current[column])) continue;
    if (sameText(current[column], value)) continue;
    update[column] = value.trim();
  }
  const updatedFields = Object.keys(update);
  if (updatedFields.length) {
    const { error: updateError } = await db.from("submissions").update(update).eq("id", submissionId);
    if (updateError) return { ok: false, errorCode: "SAVE_FAILED", error: "신청서 정보를 저장하지 못했습니다." };
  }

  let updatedTracks = 0;
  let insertedTracks = 0;
  if (options.input.tracks.length) {
    const { data: existingRows, error: tracksError } = await db
      .from("album_tracks")
      .select("id, track_no, track_title, performer, featuring, composer, lyricist, arranger, lyrics, translated_lyrics, notes, is_title, title_role, broadcast_selected")
      .eq("submission_id", submissionId)
      .order("track_no", { ascending: true });
    if (tracksError) return { ok: false, errorCode: "SAVE_FAILED", error: "트랙 정보를 확인하지 못했습니다." };
    const existing = (existingRows ?? []) as ExistingTrack[];
    const byNo = new Map(existing.map((track) => [Number(track.track_no), track]));
    let hasMainTitle = existing.some((track) => track.is_title === true && track.title_role === "MAIN");
    const inserts: Record<string, unknown>[] = [];
    for (const track of options.input.tracks) {
      const row = byNo.get(track.trackNo);
      if (!row) {
        const isTitle = track.isTitle === true;
        const role = isTitle ? (hasMainTitle ? "SUB" : "MAIN") : null;
        if (role === "MAIN") hasMainTitle = true;
        inserts.push({
          submission_id: submissionId, track_no: track.trackNo, track_title: track.trackTitle,
          performer: track.performer ?? (hasText(current.artist_name) ? current.artist_name : null),
          featuring: track.featuring, composer: track.composer, lyricist: track.lyricist, arranger: track.arranger,
          lyrics: track.lyrics, translated_lyrics: track.translatedLyrics, notes: track.notes,
          is_title: isTitle, title_role: role, broadcast_selected: track.broadcastSelected === true,
        });
        continue;
      }
      const patch: Record<string, unknown> = {};
      for (const [key, column] of Object.entries(trackColumns) as Array<[keyof typeof trackColumns, string]>) {
        const value = track[key];
        if (!hasText(value)) continue;
        if (mode === "fill-empty" && hasText(row[column])) continue;
        if (sameText(row[column], value)) continue;
        patch[column] = value.trim();
      }
      if (typeof track.isTitle === "boolean") {
        const next = mode === "fill-empty" ? row.is_title === true || track.isTitle : track.isTitle;
        if (next !== (row.is_title === true)) {
          patch.is_title = next;
          patch.title_role = next ? (hasMainTitle ? "SUB" : "MAIN") : null;
          if (next && !hasMainTitle) hasMainTitle = true;
        }
      }
      if (typeof track.broadcastSelected === "boolean") {
        const next = mode === "fill-empty" ? row.broadcast_selected === true || track.broadcastSelected : track.broadcastSelected;
        if (next !== (row.broadcast_selected === true)) patch.broadcast_selected = next;
      }
      if (!Object.keys(patch).length) continue;
      const { error: patchError } = await db.from("album_tracks").update(patch).eq("id", row.id);
      if (patchError) return { ok: false, errorCode: "SAVE_FAILED", error: `${track.trackNo}번 트랙 정보를 저장하지 못했습니다.` };
      updatedTracks += 1;
    }
    if (inserts.length) {
      const { error: insertError } = await db.from("album_tracks").insert(inserts);
      if (insertError) return { ok: false, errorCode: "SAVE_FAILED", error: "추가된 트랙을 저장하지 못했습니다." };
      insertedTracks = inserts.length;
    }
  }

  const changed = updatedFields.length > 0 || updatedTracks > 0 || insertedTracks > 0;
  if (changed) {
    const parts = [
      updatedFields.length ? `신청서 항목 ${updatedFields.length}개` : "",
      updatedTracks ? `트랙 수정 ${updatedTracks}곡` : "",
      insertedTracks ? `트랙 추가 ${insertedTracks}곡` : "",
    ].filter(Boolean).join(", ");
    const { error: eventError } = await db.from("submission_events").insert({
      submission_id: submissionId, actor_user_id: options.actorUserId, event_type: "ADMIN_BASIC_INFO",
      message: `${options.source}에서 신청서 정보를 반영했습니다. (${parts})`,
    });
    if (eventError) console.warn("[album-info] event insert skipped", { submissionId, code: eventError.code });
  }
  return { ok: true, changed, updatedFields, updatedTracks, insertedTracks };
}
