import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getAlbumReviewPriceKrw } from "@/lib/album-pricing";
import { normalizeMvDesiredRating } from "@/lib/mv-request-options";
import {
  MV_BASE_ONLINE_PRICE_KRW,
  MV_ONLINE_OPTION_CODES,
  MV_STATION_PRICE_KRW,
} from "@/lib/submission-station-selection";
import {
  buildGuestAlbumIntakeRecord,
  guestAlbumIntakeFailure,
  guestAlbumIntakeSchema,
} from "./guest-album-intake";

/** 관리자 직접 접수 from the admin web page. Albums reuse the desk's
 * admin_register_guest_album; music videos use admin_register_guest_mv
 * (20261105120000). The browser's request ID is the guest lookup code, so a
 * double click or a retry returns the submission created first. */
const optionalText = (max: number) =>
  z.string().trim().max(max).nullish().transform((value) => value || null);
const optionalDate = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal("")).nullish().transform((value) => value || null);
const optionalEmail = z.union([z.literal(""), z.string().trim().toLowerCase().email().max(200)]).nullish().transform((value) => value || null);

const guestSchema = z.object({
  name: z.string().trim().min(1).max(80),
  phone: optionalText(40),
  email: optionalEmail,
  company: optionalText(120),
});

export const MV_BROADCAST_CODES = ["KBS", "MBC", "SBS", "ETN"] as const;

export const mvIntakeSchema = z.object({
  kind: z.enum(["MV_DISTRIBUTION", "MV_BROADCAST"]),
  requestId: z.string().uuid(),
  paid: z.boolean(),
  stationCodes: z.array(z.string().trim().toUpperCase()).max(4).default([]),
  guest: guestSchema,
  mv: z.object({
    title: z.string().trim().min(1).max(200),
    artistName: z.string().trim().min(1).max(200),
    releaseDate: optionalDate,
    genre: optionalText(100),
    runtime: optionalText(40),
    director: optionalText(200),
    leadActor: optionalText(300),
    storyline: optionalText(5000),
    productionCompany: optionalText(200),
    agency: optionalText(200),
    albumTitle: optionalText(200),
    productionDate: optionalDate,
    distributionCompany: optionalText(200),
    businessRegNo: optionalText(40),
    usage: optionalText(300),
    desiredRating: optionalText(40),
    memo: optionalText(2000),
    songTitleKr: optionalText(200),
    songTitleEn: optionalText(200),
    composer: optionalText(300),
    lyricist: optionalText(300),
    arranger: optionalText(300),
    lyrics: optionalText(30000),
    applicantName: optionalText(80),
    applicantEmail: optionalEmail,
    applicantPhone: optionalText(40),
    adminMemo: optionalText(2000),
  }),
});
export type MvIntake = z.infer<typeof mvIntakeSchema>;

export const albumIntakeSchema = guestAlbumIntakeSchema
  .omit({ operation: true })
  .extend({ kind: z.literal("ALBUM") });
export type AlbumIntake = z.infer<typeof albumIntakeSchema>;

export const directIntakeSchema = z.discriminatedUnion("kind", [albumIntakeSchema, mvIntakeSchema]);
export type DirectIntake = z.infer<typeof directIntakeSchema>;

/** Price shown and charged for an MV request; same table as the MV wizard. */
export function mvIntakeAmountKrw(kind: MvIntake["kind"], stationCodes: string[]) {
  const allowed: readonly string[] = kind === "MV_BROADCAST" ? MV_BROADCAST_CODES : MV_ONLINE_OPTION_CODES;
  const codes = [...new Set(stationCodes.map((code) => code.trim().toUpperCase()))];
  if (codes.some((code) => !allowed.includes(code) || !(code in MV_STATION_PRICE_KRW))) return null;
  if (kind === "MV_BROADCAST" && codes.length === 0) return null;
  const base = kind === "MV_DISTRIBUTION" ? MV_BASE_ONLINE_PRICE_KRW : 0;
  return { codes, amountKrw: base + codes.reduce((sum, code) => sum + MV_STATION_PRICE_KRW[code], 0) };
}

export function buildGuestMvIntakeParent(input: MvIntake, artistId: string | null) {
  const mv = input.mv;
  return {
    title: mv.title, artist_name: mv.artistName, artist_id: artistId, release_date: mv.releaseDate, genre: mv.genre,
    mv_runtime: mv.runtime, mv_director: mv.director, mv_lead_actor: mv.leadActor, mv_storyline: mv.storyline,
    mv_production_company: mv.productionCompany, mv_agency: mv.agency, mv_album_title: mv.albumTitle,
    mv_production_date: mv.productionDate, mv_distribution_company: mv.distributionCompany,
    mv_business_reg_no: mv.businessRegNo, mv_usage: mv.usage,
    // The wizard stores the customer's wish as a Korean label; the admin's
    // final rating replaces it later.
    mv_desired_rating: input.kind === "MV_DISTRIBUTION" ? normalizeMvDesiredRating(mv.desiredRating) || null : null,
    mv_memo: mv.memo, mv_song_title_kr: mv.songTitleKr, mv_song_title_en: mv.songTitleEn,
    mv_composer: mv.composer, mv_lyricist: mv.lyricist, mv_arranger: mv.arranger, mv_lyrics: mv.lyrics,
    applicant_name: mv.applicantName || input.guest.name, applicant_email: mv.applicantEmail || input.guest.email,
    applicant_phone: mv.applicantPhone || input.guest.phone,
    guest_name: input.guest.name, guest_phone: input.guest.phone, guest_email: input.guest.email, guest_company: input.guest.company,
    admin_memo: mv.adminMemo,
  };
}

const mvErrors: Record<string, [number, string]> = {
  MV_TYPE_INVALID: [400, "뮤직비디오 심의 유형을 선택해주세요."],
  MV_FIELDS_REQUIRED: [400, "뮤직비디오 곡명과 아티스트명을 입력해주세요."],
  MV_STATIONS_INVALID: [400, "신청 방송사 선택을 확인해주세요. 방송 뮤비는 1곳 이상 선택해야 합니다."],
};

export type DirectIntakeResult =
  | { ok: true; created: boolean; submissionId: string; guestToken: string }
  | { ok: false; status: number; error: string };

/** Registers the checked draft. The caller has authorized the administrator. */
export async function registerDirectIntake(
  db: SupabaseClient,
  input: DirectIntake,
  options: { actorUserId: string; ensureArtist: (name: string) => Promise<string | null> },
): Promise<DirectIntakeResult> {
  const fail = (status: number, error: string): DirectIntakeResult => ({ ok: false, status, error });
  const known = (message: string | undefined) =>
    guestAlbumIntakeFailure(message) ?? Object.entries(mvErrors).find(([code]) => message?.includes(code))?.[1] ?? null;

  if (input.kind === "ALBUM") {
    const { data: pkg, error: packageError } = await db.from("packages").select("price_krw").eq("id", input.packageId).eq("is_active", true).maybeSingle();
    if (packageError) return fail(503, "패키지 정보를 확인하지 못했습니다. 잠시 후 다시 시도해주세요.");
    if (!pkg) return fail(400, "선택한 패키지를 사용할 수 없습니다. 패키지를 다시 선택해주세요.");
    const artistId = await options.ensureArtist(input.submission.artistName).catch(() => null);
    const record = buildGuestAlbumIntakeRecord({ ...input, operation: "register-guest-album" }, artistId);
    const { data, error } = await db.rpc("admin_register_guest_album", {
      p_actor_user_id: options.actorUserId, p_guest_token: input.requestId, p_package_id: input.packageId,
      p_amount_krw: getAlbumReviewPriceKrw(Number(pkg.price_krw)), p_paid: input.paid, p_parent: record.parent, p_tracks: record.tracks,
    });
    if (error) {
      const mapped = known(error.message);
      return mapped ? fail(mapped[0], mapped[1]) : fail(500, "비회원 음반 접수를 만들지 못했습니다. 잠시 후 다시 시도해주세요.");
    }
    const row = (Array.isArray(data) ? data[0] : data) as { submission_id?: string; created?: boolean } | null;
    if (!row?.submission_id) return fail(500, "비회원 음반 접수를 만들지 못했습니다. 잠시 후 다시 시도해주세요.");
    return { ok: true, created: row.created === true, submissionId: row.submission_id, guestToken: input.requestId };
  }

  const pricing = mvIntakeAmountKrw(input.kind, input.stationCodes);
  if (!pricing) return fail(400, mvErrors.MV_STATIONS_INVALID[1]);
  const artistId = await options.ensureArtist(input.mv.artistName).catch(() => null);
  const { data, error } = await db.rpc("admin_register_guest_mv", {
    p_actor_user_id: options.actorUserId, p_guest_token: input.requestId, p_type: input.kind,
    p_amount_krw: pricing.amountKrw, p_paid: input.paid, p_station_codes: pricing.codes,
    p_parent: buildGuestMvIntakeParent(input, artistId),
  });
  if (error) {
    if (["PGRST202", "42883"].includes(error.code ?? "")) return fail(503, "뮤직비디오 직접 접수 설정(데이터베이스 마이그레이션)이 아직 적용되지 않았습니다.");
    const mapped = known(error.message);
    return mapped ? fail(mapped[0], mapped[1]) : fail(500, "비회원 뮤직비디오 접수를 만들지 못했습니다. 잠시 후 다시 시도해주세요.");
  }
  const row = (Array.isArray(data) ? data[0] : data) as { submission_id?: string; created?: boolean } | null;
  if (!row?.submission_id) return fail(500, "비회원 뮤직비디오 접수를 만들지 못했습니다. 잠시 후 다시 시도해주세요.");
  return { ok: true, created: row.created === true, submissionId: row.submission_id, guestToken: input.requestId };
}
