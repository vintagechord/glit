import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getAlbumReviewPriceKrw } from "@/lib/album-pricing";

/** An album review the customer sent by email, registered by an administrator
 * as a guest (비회원) submission so the customer can follow results with a
 * lookup code. The review desk sends the data it imported from the customer's
 * reference file. */
const optionalText = (max: number) =>
  z.string().trim().max(max).nullish().transform((value) => value || null);

export const guestAlbumIntakeSchema = z.object({
  operation: z.literal("register-guest-album"),
  requestId: z.string().uuid(),
  packageId: z.string().uuid(),
  paid: z.boolean(),
  guest: z.object({
    name: z.string().trim().min(1).max(80),
    phone: optionalText(40),
    email: z.union([z.literal(""), z.string().trim().email().max(200)]).nullish().transform((value) => value || null),
    company: optionalText(120),
  }),
  submission: z.object({
    title: z.string().trim().min(1).max(200),
    artistName: z.string().trim().min(1).max(200),
    artistNameEn: optionalText(200),
    releaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().transform((value) => value || null),
    genre: optionalText(100),
    distributor: optionalText(200),
    productionCompany: optionalText(200),
    previousRelease: optionalText(500),
    artistType: z.enum(["SOLO", "GROUP"]).nullish().transform((value) => value || null),
    artistMembers: optionalText(1000),
    applicantName: optionalText(80),
    applicantEmail: optionalText(200),
    applicantPhone: optionalText(40),
    adminMemo: optionalText(2000),
  }),
  tracks: z.array(z.object({
    trackTitle: z.string().trim().min(1).max(300),
    performer: optionalText(300),
    featuring: optionalText(300),
    composer: optionalText(300),
    lyricist: optionalText(300),
    arranger: optionalText(300),
    lyrics: optionalText(30000),
    translatedLyrics: optionalText(30000),
    isTitle: z.boolean().default(false),
    broadcastSelected: z.boolean().default(false),
  })).min(1).max(100),
});
export type GuestAlbumIntake = z.infer<typeof guestAlbumIntakeSchema>;

export type IntakePackage = { id: string; name: string; stationCount: number; priceKrw: number; stations: string[] };

/** Active album packages whose active stations match their station count. */
export async function listGuestAlbumIntakePackages(db: Pick<SupabaseClient, "from">): Promise<IntakePackage[]> {
  const { data: packages, error } = await db.from("packages")
    .select("id, name, station_count, price_krw").eq("is_active", true).order("station_count");
  if (error) throw error;
  const ids = (packages ?? []).map((item) => String(item.id));
  if (!ids.length) return [];
  const { data: links, error: linkError } = await db.from("package_stations")
    .select("package_id, station:stations(name, code, is_active)").in("package_id", ids);
  if (linkError) throw linkError;
  return (packages ?? []).map((item) => {
    const stations = (links ?? [])
      .filter((link) => String(link.package_id) === String(item.id))
      .map((link) => (Array.isArray(link.station) ? link.station[0] : link.station) as { name?: string; code?: string; is_active?: boolean } | null)
      .filter((station) => station?.is_active)
      .map((station) => station?.name || station?.code || "방송사");
    return { id: String(item.id), name: String(item.name), stationCount: Number(item.station_count), priceKrw: getAlbumReviewPriceKrw(Number(item.price_krw)), stations };
  }).filter((item) => item.stations.length > 0 && item.stations.length === item.stationCount && item.priceKrw > 0);
}

/** The arguments for admin_register_guest_album. Title tracks follow the web
 * wizard: a single track is the main title; otherwise the first marked title
 * is MAIN and the other marked titles are SUB. */
export function buildGuestAlbumIntakeRecord(input: GuestAlbumIntake, artistId: string | null) {
  const single = input.tracks.length === 1;
  let mainAssigned = false;
  const tracks = input.tracks.map((track) => {
    const isTitle = single || track.isTitle;
    const role = isTitle ? (mainAssigned ? "SUB" : "MAIN") : null;
    if (role === "MAIN") mainAssigned = true;
    return {
      track_title: track.trackTitle, performer: track.performer, featuring: track.featuring, composer: track.composer,
      lyricist: track.lyricist, arranger: track.arranger, lyrics: track.lyrics, translated_lyrics: track.translatedLyrics,
      is_title: isTitle, title_role: role, broadcast_selected: track.broadcastSelected,
    };
  });
  const s = input.submission;
  return {
    parent: {
      title: s.title, artist_name: s.artistName, artist_id: artistId, artist_name_en: s.artistNameEn, release_date: s.releaseDate,
      genre: s.genre, distributor: s.distributor, production_company: s.productionCompany, previous_release: s.previousRelease,
      artist_type: s.artistType, artist_members: s.artistMembers,
      applicant_name: s.applicantName || input.guest.name, applicant_email: s.applicantEmail || input.guest.email,
      applicant_phone: s.applicantPhone || input.guest.phone,
      guest_name: input.guest.name, guest_phone: input.guest.phone, guest_email: input.guest.email, guest_company: input.guest.company,
      admin_memo: s.adminMemo,
    },
    tracks,
  };
}

const intakeErrors: Record<string, [number, string]> = {
  PACKAGE_INVALID: [400, "선택한 패키지를 사용할 수 없습니다. 패키지를 다시 선택해주세요."],
  PACKAGE_STATIONS_INVALID: [400, "패키지의 방송사 구성이 맞지 않습니다. 관리자 설정에서 패키지 방송사를 확인해주세요."],
  ALBUM_FIELDS_REQUIRED: [400, "앨범 제목과 아티스트명을 입력해주세요."],
  GUEST_NAME_REQUIRED: [400, "고객 이름을 입력해주세요."],
  RELEASE_DATE_INVALID: [400, "발매일은 2026-11-05 형식으로 입력해주세요."],
  ALBUM_TRACKS_INVALID: [400, "곡 제목이 있는 트랙을 1곡 이상 입력해주세요."],
  AMOUNT_INVALID: [400, "패키지 금액을 확인해주세요."],
  GUEST_TOKEN_TAKEN: [409, "이미 사용 중인 조회 코드입니다. 다시 시도해주세요."],
};
export function guestAlbumIntakeFailure(message: string | undefined): [number, string] | null {
  const code = Object.keys(intakeErrors).find((key) => message?.includes(key));
  return code ? intakeErrors[code] : null;
}
