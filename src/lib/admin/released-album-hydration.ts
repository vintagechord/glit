import type { SupabaseClient } from "@supabase/supabase-js";
import { after } from "next/server";

import {
  hydrateReleasedAlbumBundle,
  loadReviewDocSubmissionBundles,
  type ReviewDocSubmissionBundle,
} from "@/lib/admin/review-docs";
import { albumInfoSchema, saveManagedAlbumInfo, type AlbumInfoInput } from "@/lib/admin/album-info-save";
import { createAdminClient } from "@/lib/supabase/admin";

/** A released-album (URL) request only carries the Melon/Genie link. The
 * review documents are built from the catalog on demand; this module writes
 * the same album details and tracks into the submission so the admin detail
 * page and the customer's application view show them. Only blank fields are
 * completed, so a customer's or administrator's own entries always win. */
export const RELEASED_ALBUM_SOURCE = "멜론·지니 앨범 정보";

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/** Catalog dates arrive as 2026.07.21, 2026-07-21 or 2026년 7월 21일. */
export const toIsoDate = (value: unknown) => {
  const match = text(value).match(/^(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})\s*일?\s*\.?$/);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
};

export function albumInfoFromBundle(bundle: ReviewDocSubmissionBundle): AlbumInfoInput {
  const s = bundle.submission;
  const parsed = albumInfoSchema.safeParse({
    submission: {
      title: text(s.title) || null,
      artistName: text(s.artist_name) || null,
      releaseDate: toIsoDate(s.release_date),
      genre: text(s.genre) || null,
      distributor: text(s.distributor) || null,
      productionCompany: text(s.production_company) || null,
    },
    tracks: bundle.tracks
      .map((track, index) => ({
        trackNo: Number(track.track_no) || index + 1,
        trackTitle: text(track.track_title).slice(0, 300),
        performer: text(track.performer) || null,
        composer: text(track.composer).slice(0, 300) || null,
        lyricist: text(track.lyricist).slice(0, 300) || null,
        arranger: text(track.arranger).slice(0, 300) || null,
        lyrics: text(track.lyrics).slice(0, 30000) || null,
        notes: text(track.notes).slice(0, 1000) || null,
        isTitle: track.is_title === true,
        broadcastSelected: track.broadcast_selected === true,
      }))
      .filter((track) => track.trackTitle)
      .slice(0, 100),
  });
  return parsed.success ? parsed.data : albumInfoSchema.parse({});
}

export type ReleasedAlbumHydrationResult =
  | { ok: true; changed: boolean; skipped?: "not-released-album" | "complete"; updatedFields: string[]; updatedTracks: number; insertedTracks: number }
  | { ok: false; error: string };

/** Fetches the album from the saved link and completes the submission. Safe
 * to repeat: a request that already has every field makes no catalog call. */
export async function hydrateReleasedAlbumSubmission(
  db: SupabaseClient,
  submissionId: string,
  options: { actorUserId?: string | null; fetcher?: typeof fetch } = {},
): Promise<ReleasedAlbumHydrationResult> {
  try {
    const [bundle] = await loadReviewDocSubmissionBundles(db, [submissionId]);
    if (!bundle || bundle.submission.is_oneclick !== true) {
      return { ok: true, changed: false, skipped: "not-released-album", updatedFields: [], updatedTracks: 0, insertedTracks: 0 };
    }
    const hydrated = await hydrateReleasedAlbumBundle(bundle, { fetcher: options.fetcher });
    if (hydrated === bundle) {
      return { ok: true, changed: false, skipped: "complete", updatedFields: [], updatedTracks: 0, insertedTracks: 0 };
    }
    const saved = await saveManagedAlbumInfo(db, {
      submissionId, actorUserId: options.actorUserId ?? null, input: albumInfoFromBundle(hydrated),
      mode: "fill-empty", source: RELEASED_ALBUM_SOURCE,
    });
    if (!saved.ok) return { ok: false, error: saved.error };
    return { ok: true, changed: saved.changed, updatedFields: saved.updatedFields, updatedTracks: saved.updatedTracks, insertedTracks: saved.insertedTracks };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "앨범 정보를 불러오지 못했습니다." };
  }
}

/** Stores what a review-docs ZIP was generated from, for released-album requests only. */
export async function persistHydratedReleasedAlbums(
  db: SupabaseClient,
  bundles: ReviewDocSubmissionBundle[],
  actorUserId: string | null,
) {
  for (const bundle of bundles) {
    const submissionId = text(bundle.submission.id);
    if (!submissionId || bundle.submission.is_oneclick !== true) continue;
    try {
      const saved = await saveManagedAlbumInfo(db, {
        submissionId, actorUserId, input: albumInfoFromBundle(bundle), mode: "fill-empty", source: RELEASED_ALBUM_SOURCE,
      });
      if (!saved.ok) console.warn("[released-album] persist skipped", { submissionId, error: saved.errorCode });
    } catch (error) {
      console.warn("[released-album] persist failed", { submissionId, message: error instanceof Error ? error.message : "unknown" });
    }
  }
}

/** Best-effort completion after a customer's intake or payment: runs after the
 * response when a request scope is available and never fails the caller. */
export function scheduleReleasedAlbumHydration(submissionId: string) {
  const run = async () => {
    const result = await hydrateReleasedAlbumSubmission(createAdminClient(), submissionId);
    if (!result.ok) console.warn("[released-album] background hydration failed", { submissionId, error: result.error });
  };
  try {
    after(() => run().catch((error) => console.warn("[released-album] background hydration error", { submissionId, message: error instanceof Error ? error.message : "unknown" })));
  } catch {
    void run().catch(() => undefined);
  }
}
