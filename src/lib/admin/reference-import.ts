import path from "node:path";

import { importReferenceDocument } from "../../../tools/onside-desk/manual-import.mjs";
import { normalizeReviewDate } from "@/lib/review-docs/model";
import { normalizeMvDesiredRating } from "@/lib/mv-request-options";

/**
 * 관리자 직접 접수: reads the application form (기준파일) a customer sent by
 * email or messenger with the review desk's form reader, so the web and the
 * desk fill the same fields. Legacy Word files are read on the server
 * instead of through macOS textutil. The result is a draft the administrator
 * checks and corrects before anything is saved.
 */
export type IntakeKind = "ALBUM" | "MV_DISTRIBUTION" | "MV_BROADCAST";
export const intakeKinds: readonly IntakeKind[] = ["ALBUM", "MV_DISTRIBUTION", "MV_BROADCAST"];
export const REFERENCE_FILE_EXTENSIONS = [".hwp", ".hwpx", ".doc", ".docx"] as const;

export type IntakeTrackDraft = {
  trackTitle: string; isTitle: boolean; performer: string; featuring: string;
  composer: string; lyricist: string; arranger: string; lyrics: string; translatedLyrics: string;
};

export type IntakeDraft = {
  kind: IntakeKind;
  format: string;
  fileName: string;
  warnings: string[];
  applicant: { name: string; email: string; phone: string };
  album: {
    title: string; artistName: string; artistNameEn: string; releaseDate: string; genre: string;
    distributor: string; productionCompany: string; previousRelease: string;
    artistType: "" | "SOLO" | "GROUP"; artistMembers: string;
  };
  tracks: IntakeTrackDraft[];
  mv: {
    title: string; artistName: string; releaseDate: string; genre: string; runtime: string;
    director: string; leadActor: string; storyline: string; productionCompany: string; agency: string;
    albumTitle: string; productionDate: string; distributionCompany: string; businessRegNo: string;
    usage: string; desiredRating: string; memo: string; songTitleKr: string; songTitleEn: string;
    composer: string; lyricist: string; arranger: string; lyrics: string;
  };
};

export class ReferenceImportError extends Error {
  constructor(readonly code: string, message: string, readonly status = 400) {
    super(message);
    this.name = "ReferenceImportError";
  }
}

// Guidance printed in the Onside/GLIT application forms (DOC and HWP). A
// blank or partly filled form returns these as values; they are never data.
const FORM_GUIDANCE = new Set([
  "댄스, 발라드, 성인가요, 락, 일렉트로닉, R&B, O.S.T, 포크, 힙합, 모던락, 락발라드, 레게 중에 선택해 주세요.",
  "그룹일 경우 팀원이름을 적어주세요.",
  "1. 아티스트의 이전 발표곡 기입",
  "2. 피쳐링이 있을 경우 피쳐링 뮤지션의 이전 발매곡도 함께 적어주세요.",
  "(MBC 요구사항)",
  "* 신인인 경우 신인이라 표기",
  "※ 유의사항",
  "1. 코러스, 나레이션, 반복하는 후렴을 포함하여 모든 가사를 수록해야 합니다.",
  "2. 음원과 다르게 고의로 가사(욕설 및 선정성 문구 포함)를 누락하는 경우 심의가 불가하며, 향후 방송사에서 해당 음반기획사의 심의를 거부할 수 있습니다.",
  "3. 외국어 가사에는 반드시 번역을 나란히 기재해주세요.",
  "4. 심의요청서의 곡 순서와 CD 순서는 반드시 일치해야 합니다.",
  "타이틀곡 지정해 주시고 4곡 이상의 앨범일 경우 원음방송 심의를 위해",
  "3곡 지정 해주세요. (원음방송은 앨범당 3곡만 심의가 가능합니다.)",
  "YTN과 평화방송의 경우 타이틀곡(1곡)만 심의 가능합니다.",
  "그룹일 경우 멤버 이름을 적어주세요.",
  "추가곡이 있을시 표를 복사해서 넣어주세요.",
  "감독명 써주세요",
  "(ex.음악사이트 기재 )",
  "줄거리는 결말까지 작성하셔야 합니다.",
  "아티스트명과 외국표기용 영문도 써주세요.",
  "아티스트명과 외국표기용",
  "영문도 써주세요.",
  "ex)발라드 등",
  "가사의 외국어는 반드시 번역 이 있어야 합니다.",
  "가사의 외국어는 번역본이 있어야 합니다.",
  "없으면 안적으셔도 됩니다",
].map((line) => line.replace(/\s+/g, " ").trim()));
// Short fields only: lyrics and storylines may legitimately say "…주세요".
const GUIDANCE_PATTERNS = [
  /^\(?\s*ex[.)]/i,
  /^예\)/,
  /^※/,
  /(?:써|적어|기입해|작성해|선택해|입력해|넣어|지정\s*해)\s*주세요\.?\)?$/,
  /작성하셔야\s*합니다\.?$/,
  /없으면\s*안\s*적으셔도/,
  /없을\s*시\s*미기입/,
];
const LABEL_ARTIFACTS = new Set(["작곡", "작곡자", "작사", "작사자", "편곡", "편곡자", "곡명", "가사"]);

const text = (value: unknown) => (typeof value === "string" ? value : value == null ? "" : String(value)).replace(/\r\n?/g, "\n");

/** Removes form guidance lines; long text keeps everything but exact guidance. */
export function stripFormGuidance(value: unknown, options: { long?: boolean } = {}) {
  const original = text(value).trim();
  if (!original) return { value: "", removed: false };
  if (!options.long && LABEL_ARTIFACTS.has(original)) return { value: "", removed: true };
  const kept = original.split("\n").filter((line) => {
    const normalized = line.replace(/\s+/g, " ").trim();
    if (!normalized) return true;
    if (FORM_GUIDANCE.has(normalized)) return false;
    return options.long || !GUIDANCE_PATTERNS.some((pattern) => pattern.test(normalized));
  });
  const cleaned = kept.join("\n").replace(/^\s+|\s+$/g, "");
  return { value: cleaned, removed: cleaned !== original };
}

const artistTypeOf = (value: string): "" | "SOLO" | "GROUP" => {
  const normalized = value.replace(/\s+/g, "");
  const group = /그룹|group|듀오|duo|밴드|band|팀/i.test(normalized);
  const solo = /솔로|solo/i.test(normalized);
  return group === solo ? "" : group ? "GROUP" : "SOLO";
};

const isoDate = (value: string) => {
  const normalized = normalizeReviewDate(value.replace(/\.$/, ""));
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : "";
};

type DeskImport = {
  submission: Record<string, unknown>;
  tracks: Array<Record<string, unknown>>;
  warnings: string[];
  format: string;
};

async function readReference(body: Buffer, fileName: string, kind: IntakeKind): Promise<DeskImport> {
  const extension = path.extname(fileName).toLowerCase();
  if (!(REFERENCE_FILE_EXTENSIONS as readonly string[]).includes(extension)) {
    throw new ReferenceImportError("UNSUPPORTED_FORMAT", "HWP, HWPX, DOC, DOCX 신청서만 분석할 수 있습니다. PDF·이미지는 내용을 보고 직접 입력해주세요.");
  }
  try {
    // The desk reader handles DOC with its table-preserving reader (no Mac converter needed).
    return await importReferenceDocument({ body, filename: `reference${extension}`, type: kind }) as DeskImport;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code && error instanceof Error) throw new ReferenceImportError(code, error.message);
    throw new ReferenceImportError("EXTRACTION_FAILED", "신청서를 읽지 못했습니다. 파일이 손상되지 않았는지 확인하거나 DOCX로 저장해 다시 올려주세요.", 422);
  }
}

const fieldLabels: Record<string, string> = {
  title: "제목", artist_name: "아티스트", artist_name_en: "영문 아티스트명", genre: "장르", artist_type: "그룹/솔로",
  members: "구성원", previous_release: "이전 발매곡", mv_director: "감독", mv_usage: "용도", mv_storyline: "줄거리",
  mv_desired_rating: "희망 등급", mv_lyrics: "가사", release_date: "발매일", distributor: "유통사",
  production_company: "기획사", applicant_name: "신청자", applicant_email: "이메일", applicant_phone: "연락처",
  mv_song_title: "곡명", mv_memo: "메모", mv_agency: "대행사", mv_lead_actor: "주연", mv_runtime: "러닝타임",
};

export async function analyzeReferenceFile(input: { body: Buffer; fileName: string; kind: IntakeKind }): Promise<IntakeDraft> {
  const result = await readReference(input.body, input.fileName, input.kind);
  const warnings = [...result.warnings];
  const cleaned = new Set<string>();
  const field = (key: string, options: { long?: boolean } = {}) => {
    const { value, removed } = stripFormGuidance(result.submission[key], options);
    if (removed) cleaned.add(fieldLabels[key] ?? key);
    return value;
  };

  const releaseRaw = field("release_date");
  const productionRaw = field("production_date");
  const releaseDate = isoDate(releaseRaw);
  const productionDate = isoDate(productionRaw);
  if (releaseRaw && !releaseDate) warnings.push(`날짜 '${releaseRaw}'를 확정할 수 없어 비워 두었습니다. 연도·월·일을 확인해 입력해주세요.`);
  if (productionRaw && !productionDate) warnings.push(`제작일 '${productionRaw}'를 확정할 수 없어 비워 두었습니다.`);

  const artistTypeRaw = field("artist_type");
  const artistType = artistTypeOf(artistTypeRaw);
  // "그룹(멤버1, 멤버2)" keeps the members the form put in the type cell.
  const members = field("members") || (artistType === "GROUP" ? artistTypeRaw.replace(/^[^(（]*[(（]|[)）]\s*$/g, "").trim() : "");
  const email = field("applicant_email").toLowerCase();

  const tracks = result.tracks.map((track) => {
    const strip = (key: string, long = false) => {
      const { value, removed } = stripFormGuidance(track[key], { long });
      if (removed) cleaned.add(key === "lyrics" ? "가사" : key === "track_title" ? "곡명" : "트랙 크레딧");
      return value;
    };
    return {
      trackTitle: strip("track_title"), isTitle: track.is_title === true, performer: strip("performer"),
      featuring: strip("featuring"), composer: strip("composer"), lyricist: strip("lyricist"), arranger: strip("arranger"),
      lyrics: strip("lyrics", true), translatedLyrics: strip("translated_lyrics", true),
    };
  }).filter((track) => track.trackTitle || track.lyrics || track.composer || track.lyricist);

  const songTitle = field("mv_song_title") || field("title");
  const desiredRatingRaw = field("mv_desired_rating");
  const desiredRating = normalizeMvDesiredRating(desiredRatingRaw);
  if (desiredRatingRaw && !desiredRating) warnings.push(`희망 등급 '${desiredRatingRaw}'을(를) 인식하지 못했습니다. 등급을 선택해주세요.`);
  if (cleaned.size) warnings.push(`양식 안내문은 값에서 제외했습니다: ${[...cleaned].join(", ")}. 실제 내용이 빠지지 않았는지 원문과 비교해주세요.`);

  return {
    kind: input.kind,
    format: result.format,
    fileName: input.fileName,
    warnings: [...new Set(warnings)],
    applicant: { name: field("applicant_name"), email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "", phone: field("applicant_phone") },
    album: {
      title: field("title"), artistName: field("artist_name"), artistNameEn: field("artist_name_en"), releaseDate,
      genre: field("genre"), distributor: field("distributor"), productionCompany: field("production_company"),
      previousRelease: field("previous_release", { long: true }), artistType, artistMembers: members,
    },
    tracks,
    mv: {
      title: songTitle, artistName: field("artist_name"), releaseDate, genre: field("genre"), runtime: field("mv_runtime"),
      director: field("mv_director"), leadActor: field("mv_lead_actor"), storyline: field("mv_storyline", { long: true }),
      productionCompany: field("mv_production_company"), agency: field("mv_agency"), albumTitle: field("mv_album_title"),
      productionDate, distributionCompany: field("mv_distribution_company"), businessRegNo: field("mv_business_reg_no"),
      usage: field("mv_usage"), desiredRating, memo: field("mv_memo", { long: true }), songTitleKr: field("mv_song_title_kr"),
      songTitleEn: field("mv_song_title_en"), composer: field("mv_composer"), lyricist: field("mv_lyricist"),
      arranger: field("mv_arranger"), lyrics: field("mv_lyrics", { long: true }),
    },
  };
}
