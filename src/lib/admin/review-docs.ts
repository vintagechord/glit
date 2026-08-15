import { readFile } from "node:fs/promises";
import path from "node:path";

import type { SupabaseClient } from "@supabase/supabase-js";
import { ZipFile } from "yazl";

import { formatDate, formatDateTime } from "@/lib/format";
import {
  GenieReviewDataError,
  extractGenieAlbumId,
  fetchGenieAlbumReviewData,
  type GenieFetchOptions,
  type GenieTrackReviewData,
} from "@/lib/genie";
import {
  MelonReviewDataError,
  extractMelonAlbumId,
  fetchMelonAlbumReviewData,
  type MelonAlbumReviewData,
  type MelonFetchOptions,
  type MelonTrackReviewData,
} from "@/lib/melon";
import {
  renderReviewDocTemplate,
  ReviewDocTemplateRenderError,
  type ReviewDocTemplateValue,
} from "@/lib/admin/review-docs-docx";

const TEMPLATE_DIR = path.join(process.cwd(), "templates", "review-docs");

export const REVIEW_DOC_TEMPLATE_FILES = {
  songReviewRequest: "song-review-request.docx",
  reviewForm: "review-form.docx",
  lyricsAll: "lyrics-all.docx",
  lyricsTrack: "lyrics-track.docx",
  tbsIntegrated: "tbs-integrated.docx",
  wbsIntegrated: "wbs-integrated.docx",
  pbcIntegrated: "pbc-integrated.docx",
} as const;

type DbRecord = Record<string, unknown>;

const FIXED_CONTACT = {
  name: "정준영",
  phone: "010-9068-9035",
  email: "vintagechord@daum.net",
} as const;

const REVIEW_COMPANY = "빈티지코드";

export type ReviewDocSubmissionBundle = {
  submission: DbRecord;
  tracks: DbRecord[];
  files: DbRecord[];
  events: DbRecord[];
};

type MusicSourceProvider = "melon" | "genie";

type MusicSourceTrackData = (MelonTrackReviewData | GenieTrackReviewData) & {
  sourceNotes?: string;
};

type MusicSourceAlbumData = Omit<MelonAlbumReviewData, "tracks"> & {
  tracks: MusicSourceTrackData[];
};

type FetchedMusicSourceAlbum = MusicSourceAlbumData & {
  provider: MusicSourceProvider;
  sourceIndex: number;
  sourceInput: string;
};

export type ExternalReviewDocFetchOptions = MelonFetchOptions & GenieFetchOptions;

export class ReviewDocsTemplateMissingError extends Error {
  status = 500 as const;
  missing: string[];

  constructor(missing: string[]) {
    super("심의자료 템플릿 파일이 없습니다. templates/review-docs를 확인해주세요.");
    this.name = "ReviewDocsTemplateMissingError";
    this.missing = missing;
  }
}

export class ReviewDocsDataError extends Error {
  status = 500 as const;

  constructor(message: string) {
    super(message);
    this.name = "ReviewDocsDataError";
  }
}

export class ReviewDocsNotFoundError extends Error {
  status = 404 as const;

  constructor(message = "접수를 찾을 수 없습니다.") {
    super(message);
    this.name = "ReviewDocsNotFoundError";
  }
}

export class ReviewDocsInputError extends Error {
  status = 400 as const;

  constructor(message: string) {
    super(message);
    this.name = "ReviewDocsInputError";
  }
}

export class ReviewDocsUnsupportedTypeError extends Error {
  status = 400 as const;

  constructor(message = "온라인 일반 음반 신청만 심의자료 자동 생성이 가능합니다.") {
    super(message);
    this.name = "ReviewDocsUnsupportedTypeError";
  }
}

export class ReviewDocsRenderError extends Error {
  status = 500 as const;

  constructor(message: string) {
    super(message);
    this.name = "ReviewDocsRenderError";
  }
}

type ReviewDocTemplateKey = keyof typeof REVIEW_DOC_TEMPLATE_FILES;
type ReviewDocTemplates = Record<ReviewDocTemplateKey, Buffer>;

async function loadReviewDocTemplates(templateDir = TEMPLATE_DIR) {
  const entries = Object.entries(REVIEW_DOC_TEMPLATE_FILES) as Array<
    [ReviewDocTemplateKey, string]
  >;
  const checks = await Promise.all(
    entries.map(async ([key, filename]) => {
      const filePath = path.join(templateDir, filename);
      try {
        return { key, filename, buffer: await readFile(filePath) };
      } catch (error) {
        const code =
          error && typeof error === "object" && "code" in error
            ? String(error.code)
            : "";
        if (code === "ENOENT" || code === "ENOTDIR") {
          return { key, filename, buffer: null };
        }
        throw new ReviewDocsRenderError(
          `심의자료 템플릿을 읽을 수 없습니다: ${filename}. templates/review-docs의 파일 권한을 확인해주세요.`,
        );
      }
    }),
  );
  const missing = checks
    .filter((entry) => entry.buffer === null)
    .map((entry) => entry.filename);
  if (missing.length > 0) {
    throw new ReviewDocsTemplateMissingError(missing);
  }

  return Object.fromEntries(
    checks.map((entry) => [entry.key, entry.buffer]),
  ) as ReviewDocTemplates;
}

const valueToText = (value: unknown) => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.normalize("NFC").trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
};

const getText = (record: DbRecord, key: string) => valueToText(record[key]);

const getNumber = (record: DbRecord, key: string) => {
  const value = record[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
};

const getBoolean = (record: DbRecord, key: string) => record[key] === true;

const booleanLabel = (value: boolean) => (value ? "예" : "아니오");

const hasText = (value: unknown) => valueToText(value).length > 0;

const toDateParts = (value?: string | null) => {
  if (!value) return null;
  const text = value.trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() + 1 !== month ||
      date.getUTCDate() !== day
    ) {
      return null;
    }
    return { year, month, day };
  }
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return null;
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
  };
};

const seoulTodayParts = () => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
  };
};

const two = (value: number) => String(value).padStart(2, "0");

const formatLongKorean = (parts: ReturnType<typeof seoulTodayParts>) =>
  `${parts.year}년 ${two(parts.month)}월 ${two(parts.day)}일`;

const formatLongDot = (parts: ReturnType<typeof seoulTodayParts> | null) =>
  parts ? `${parts.year}. ${two(parts.month)}. ${two(parts.day)}.` : "";

const formatShortDot = (parts: ReturnType<typeof seoulTodayParts> | null) =>
  parts ? `${String(parts.year).slice(-2)}.${two(parts.month)}.${two(parts.day)}` : "";

const formatMonthDay = (parts: ReturnType<typeof seoulTodayParts> | null) =>
  parts ? `${two(parts.month)}/${two(parts.day)}` : "";

const isInstrumentalTitle = (title: string) =>
  /\b(inst|instrumental|mr|karaoke)\b/i.test(title) ||
  /반주|가사\s*없음/i.test(title);

const compactLyrics = (value: string) =>
  value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .reduce<string[]>((lines, line) => {
      if (!line.trim() && !lines[lines.length - 1]?.trim()) return lines;
      lines.push(line);
      return lines;
    }, [])
    .join("\n")
    .trim();

const appendTranslatedLyrics = (lyrics: string, translatedLyrics: string) => {
  const base = compactLyrics(lyrics);
  const translated = compactLyrics(translatedLyrics);
  if (!base && !translated) return "";
  if (!translated) {
    // 1차 구현은 저장된 translated_lyrics만 사용한다. 서버에서 임의로
    // 외부 번역 API를 호출하지 않으며, 번역이 없으면 원문을 그대로 둔다.
    return base;
  }
  if (!base) return translated;
  if (base.includes("번역 :") || base.includes("번역:")) return base;
  return `${base}\n\n(번역 : ${translated})`;
};

const getGenreCheckboxLine = (genre: string) => {
  const normalized = genre.toLowerCase();
  const labels = [
    ["댄스", /dance|댄스/],
    ["발라드", /ballad|발라드/],
    ["성인가요", /성인가요|트로트/],
    ["락", /rock|록|락/],
    ["일렉트로닉", /electronic|일렉트로닉|전자/],
    ["R&B", /r&b|알앤비/],
    ["O.S.T", /ost|o\.s\.t|오에스티/],
    ["포크", /folk|포크/],
    ["힙합", /hiphop|hip-hop|힙합/],
    ["모던락", /모던락|modern rock/],
    ["락발라드", /락발라드|록발라드/],
    ["레게", /reggae|레게/],
  ] as const;
  const matched = labels.find(([, pattern]) => pattern.test(normalized));
  return labels
    .map(([label]) => `${label}${matched?.[0] === label ? "■" : "□"}`)
    .join("  ")
    .concat(matched ? "" : `  기타: ${genre}`);
};

const normalizeRecord = (record: DbRecord) =>
  Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, value ?? ""]),
  ) as DbRecord;

const sanitizeFilenamePart = (value: string, fallback: string) => {
  const cleaned = value
    .normalize("NFC")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim();
  return (cleaned || fallback).slice(0, 80);
};

const uniquePath = (pathName: string, used: Set<string>) => {
  if (!used.has(pathName)) {
    used.add(pathName);
    return pathName;
  }

  const dotIndex = pathName.lastIndexOf(".");
  const base = dotIndex > 0 ? pathName.slice(0, dotIndex) : pathName;
  const ext = dotIndex > 0 ? pathName.slice(dotIndex) : "";
  let index = 2;
  while (used.has(`${base}_${index}${ext}`)) {
    index += 1;
  }
  const next = `${base}_${index}${ext}`;
  used.add(next);
  return next;
};

const normalizeTrack = (track: DbRecord, index: number) => {
  const trackNo = getNumber(track, "track_no") ?? index + 1;
  const title =
    getText(track, "track_title") ||
    getText(track, "track_title_official") ||
    getText(track, "track_title_kr") ||
    getText(track, "track_title_en") ||
    `트랙 ${trackNo}`;
  const isTitle = getBoolean(track, "is_title");
  const broadcastSelected = getBoolean(track, "broadcast_selected");
  const lyrics = getText(track, "lyrics");
  const translatedLyrics = getText(track, "translated_lyrics");
  const lyricist = getText(track, "lyricist");
  const hasInstrumentalTitle = isInstrumentalTitle(title);
  const isInstrumental =
    hasInstrumentalTitle || (!lyrics.trim() && !lyricist.trim());
  const titleMarkers = [
    isTitle ? "(타이틀)" : "",
    isInstrumental && !hasInstrumentalTitle ? "(Inst.)" : "",
  ].filter(Boolean);
  const trackTitleForDocs = [title, ...titleMarkers].join(" ");
  const lyricsDisplay = isInstrumental
    ? "가사 없음 / Instrumental"
    : appendTranslatedLyrics(lyrics, translatedLyrics);
  const creditParts = [
    !isInstrumental && lyricist ? `작사: ${lyricist}` : "",
    getText(track, "composer") ? `작곡: ${getText(track, "composer")}` : "",
    getText(track, "arranger") ? `편곡: ${getText(track, "arranger")}` : "",
  ].filter(Boolean);

  return {
    ...normalizeRecord(track),
    index: index + 1,
    track_no: trackNo,
    track_no_padded: String(trackNo).padStart(2, "0"),
    track_title: title,
    track_title_for_docs: trackTitleForDocs,
    track_title_with_title_mark: trackTitleForDocs,
    track_title_for_filename: title,
    title,
    display_title: title,
    featuring: getText(track, "featuring"),
    composer: getText(track, "composer"),
    lyricist,
    lyricist_display: isInstrumental ? "" : lyricist,
    arranger: getText(track, "arranger"),
    performer: getText(track, "performer") || getText(track, "performers"),
    lyrics,
    lyrics_display: lyricsDisplay,
    lyrics_with_translation: lyricsDisplay,
    credit_line: creditParts.length ? `(${creditParts.join("   ")})` : "",
    translated_lyrics: translatedLyrics,
    notes: getText(track, "notes"),
    is_title: isTitle,
    is_title_label: booleanLabel(isTitle),
    is_title_text: isTitle ? "타이틀" : "",
    title_marker: isTitle ? "타이틀" : "",
    title_role: getText(track, "title_role"),
    broadcast_selected: broadcastSelected,
    broadcast_selected_label: booleanLabel(broadcastSelected),
    is_instrumental: isInstrumental,
  };
};

const normalizeArtistPart = (value: string) =>
  value
    .normalize("NFC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[\s()[\]{}·._-]+/g, "");

const buildArtistDisplay = (...values: string[]) => {
  const selected: string[] = [];
  for (const value of values) {
    const candidate = value.normalize("NFC").trim();
    if (!candidate) continue;
    const normalizedCandidate = normalizeArtistPart(candidate);
    const isDuplicate = selected.some((existing) => {
      const normalizedExisting = normalizeArtistPart(existing);
      return (
        normalizedExisting === normalizedCandidate ||
        normalizedExisting.includes(normalizedCandidate) ||
        normalizedCandidate.includes(normalizedExisting)
      );
    });
    if (!isDuplicate) selected.push(candidate);
  }
  return selected.join(" / ");
};

function buildSubmissionTemplateData(
  bundle: ReviewDocSubmissionBundle,
  index: number,
  totalCount: number,
) {
  const submission = bundle.submission;
  const rawReleaseDate = getText(submission, "release_date");
  const title = getText(submission, "title") || "제목 미입력";
  const artistNameRaw = getText(submission, "artist_name");
  const artistNameKr = getText(submission, "artist_name_kr");
  const artistNameEn = getText(submission, "artist_name_en");
  const artistName =
    buildArtistDisplay(artistNameRaw, artistNameKr, artistNameEn) ||
    "아티스트 미입력";
  const productionCompany = getText(submission, "production_company");
  const distributor = getText(submission, "distributor");
  const guestCompany = getText(submission, "guest_company");
  const actualCompany =
    productionCompany ||
    guestCompany ||
    getText(submission, "applicant_company") ||
    getText(submission, "company");
  const tracks = bundle.tracks
    .slice()
    .sort((a, b) => {
      const aNo = getNumber(a, "track_no") ?? Number.MAX_SAFE_INTEGER;
      const bNo = getNumber(b, "track_no") ?? Number.MAX_SAFE_INTEGER;
      return aNo - bNo;
    })
    .map((track, trackIndex) =>
      normalizeTrack(
        {
          ...track,
          performer: getText(track, "performer") || artistNameRaw,
        },
        trackIndex,
      ),
    );
  const files = bundle.files.map(normalizeRecord);
  const events = bundle.events.map(normalizeRecord);
  const applicantName = getText(submission, "applicant_name");
  const applicantEmail = getText(submission, "applicant_email");
  const applicantPhone = getText(submission, "applicant_phone");
  const guestName = getText(submission, "guest_name");
  const guestEmail = getText(submission, "guest_email");
  const guestPhone = getText(submission, "guest_phone");
  const todayParts = seoulTodayParts();
  const releaseParts = toDateParts(rawReleaseDate);
  const productionParts =
    toDateParts(getText(submission, "production_date")) ?? releaseParts;
  const titleTracks = tracks.filter((track) => track.is_title);
  const integratedTitleTrack = titleTracks[0] ?? tracks[0] ?? null;
  const integratedSongTracks =
    titleTracks.length > 0
      ? [
          ...titleTracks,
          ...tracks.filter(
            (track) => !titleTracks.some((titleTrack) => titleTrack.track_no === track.track_no),
          ),
        ]
      : tracks;
  const integratedSongTitles = integratedSongTracks
    .slice(0, 3)
    .map((track) => track.track_title)
    .join(", ");

  const data = {
    ...normalizeRecord(submission),
    submission: normalizeRecord(submission),
    index: index + 1,
    total_count: totalCount,
    generated_at: formatDateTime(new Date().toISOString()),
    id: getText(submission, "id"),
    submission_id: getText(submission, "id"),
    title,
    album_title: title,
    artist_name: artistName,
    artist_display: artistName,
    artist_name_raw: artistNameRaw,
    artist_name_kr: artistNameKr,
    artist_name_en: artistNameEn,
    today_long: formatLongKorean(todayParts),
    today_korean: formatLongKorean(todayParts),
    today_year: String(todayParts.year),
    today_mmdd: formatMonthDay(todayParts),
    today_short: formatMonthDay(todayParts),
    today_md: formatMonthDay(todayParts),
    release_date: releaseParts ? formatDate(rawReleaseDate) : "",
    release_date_long: formatLongDot(releaseParts),
    release_date_full: formatLongDot(releaseParts),
    release_date_short: formatShortDot(releaseParts),
    release_date_mmdd: formatMonthDay(releaseParts),
    release_date_md: formatMonthDay(releaseParts),
    production_date_long: formatLongDot(productionParts),
    production_date_short: formatShortDot(productionParts),
    release_date_raw: rawReleaseDate,
    genre: getText(submission, "genre"),
    genre_checkbox_line: getGenreCheckboxLine(getText(submission, "genre")),
    distributor,
    production_company: productionCompany,
    actual_company: actualCompany,
    production_company_actual: actualCompany,
    review_company: REVIEW_COMPANY,
    production_company_for_review: REVIEW_COMPANY,
    company_actual: actualCompany,
    company_name: actualCompany,
    planning_company: actualCompany,
    agency_company: actualCompany,
    label_company: actualCompany,
    applicant_name: applicantName,
    applicant_email: applicantEmail,
    applicant_phone: applicantPhone,
    applicant_country: getText(submission, "applicant_country"),
    guest_name: guestName,
    guest_company: guestCompany,
    guest_email: guestEmail,
    guest_phone: guestPhone,
    original_contact_name: applicantName || guestName,
    original_contact_email: applicantEmail || guestEmail,
    original_contact_phone: applicantPhone || guestPhone,
    contact_name: FIXED_CONTACT.name,
    contact_email: FIXED_CONTACT.email,
    contact_phone: FIXED_CONTACT.phone,
    manager_name: FIXED_CONTACT.name,
    manager_email: FIXED_CONTACT.email,
    manager_phone: FIXED_CONTACT.phone,
    tracks,
    title_tracks: titleTracks,
    broadcast_tracks: tracks.filter((track) => track.broadcast_selected),
    track_count: tracks.length,
    track_count_label: `${tracks.length}곡`,
    title_track_title: integratedTitleTrack?.track_title ?? "",
    title_tracks_text:
      titleTracks.map((track) => track.track_title).join(", ") ||
      integratedTitleTrack?.track_title ||
      "",
    integrated_song_titles: integratedSongTitles,
    review_songs_text: integratedSongTitles,
    files,
    file_count: files.length,
    events,
    event_count: events.length,
  };

  return data;
}

const withDocumentContext = (
  base: ReturnType<typeof buildSubmissionTemplateData>,
  overrides: DbRecord,
) => ({
  ...base,
  ...overrides,
  submission: {
    ...base.submission,
    ...overrides,
  },
});

const shouldHydrateFromMelon = (bundle: ReviewDocSubmissionBundle) => {
  const submission = bundle.submission;
  if (!getBoolean(submission, "is_oneclick")) return false;
  if (!getText(submission, "melon_url")) return false;

  const missingSubmissionBasics = [
    "title",
    "artist_name",
    "release_date",
    "genre",
    "distributor",
    "production_company",
  ].some((key) => !hasText(submission[key]));
  const missingTrackData =
    bundle.tracks.length === 0 ||
    bundle.tracks.some(
      (track) =>
        !hasText(track.track_title) ||
        !hasText(track.composer) ||
        !hasText(track.lyricist) ||
        !hasText(track.arranger) ||
        !hasText(track.lyrics),
    );

  return missingSubmissionBasics || missingTrackData;
};

const withFallback = (value: unknown, fallback: string) =>
  hasText(value) ? value : fallback || value;

const SOURCE_LABELS = {
  melon: "멜론",
  genie: "지니",
} as const;

const PRIMARY_SOURCE: MusicSourceProvider = "genie";
const FALLBACK_SOURCE: MusicSourceProvider = "melon";

const normalizeComparableText = (value: string) =>
  value
    .normalize("NFC")
    .toLowerCase()
    .replace(/[（）]/g, (char) => (char === "（" ? "(" : ")"))
    .replace(/\s+/g, "")
    .trim();

const normalizeLyricsForCompare = (value: string) =>
  value
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");

const stripAsciiParentheticalAlias = (value: string) =>
  value.replace(/\s*\((?=[^)]*[A-Za-z])[\x20-\x7e]*\)\s*/g, " ");

const normalizeContributorForCompare = (value: string) =>
  value
    .normalize("NFC")
    .split(/[,，、;]+/)
    .map((item) => normalizeComparableText(stripAsciiParentheticalAlias(item)))
    .filter(Boolean)
    .sort()
    .join(",");

const normalizeArtistForCompare = (value: string) =>
  normalizeComparableText(stripAsciiParentheticalAlias(value));

const normalizeCompanyForCompare = (value: string) =>
  normalizeComparableText(value.replace(/㈜|\(주\)|（주）|주식회사/g, ""));

const pickPreferredText = (
  values: Array<{ provider: MusicSourceProvider; value: string }>,
) => {
  const present = values.filter((entry) => entry.value.trim());
  return (
    present.find((entry) => entry.provider === PRIMARY_SOURCE)?.value ??
    present.find((entry) => entry.provider === FALLBACK_SOURCE)?.value ??
    ""
  );
};

const pickVerifiedText = (
  _label: string,
  values: Array<{ provider: MusicSourceProvider; value: string }>,
  normalize: (value: string) => string = normalizeComparableText,
) => {
  const present = values.filter((entry) => entry.value.trim());
  const preferred = pickPreferredText(present);
  if (!preferred) return "";
  const preferredKey = normalize(preferred);
  return (
    present.find(
      (entry) =>
        entry.provider === PRIMARY_SOURCE && normalize(entry.value) === preferredKey,
    )?.value ?? preferred
  );
};

const sourceKindFromUrl = (url: string): MusicSourceProvider | null => {
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (/genie\.co\.kr/i.test(trimmed) || /[?&]axnm=/i.test(trimmed)) {
    return extractGenieAlbumId(trimmed) ? "genie" : null;
  }
  if (/melon\.com/i.test(trimmed) || /[?&]albumId=/i.test(trimmed)) {
    return extractMelonAlbumId(trimmed) ? "melon" : null;
  }
  return extractMelonAlbumId(trimmed) ? "melon" : null;
};

const albumGroupKey = (album: MusicSourceAlbumData) =>
  `${normalizeArtistForCompare(album.artistName)}::${normalizeComparableText(album.albumTitle)}`;

const groupFetchedMusicAlbums = (albums: FetchedMusicSourceAlbum[]) => {
  const keyed = albums.reduce((map, album) => {
    const key = albumGroupKey(album);
    const list = map.get(key) ?? [];
    list.push(album);
    map.set(key, list);
    return map;
  }, new Map<string, FetchedMusicSourceAlbum[]>());

  return Array.from(keyed.values()).flatMap((group) => {
    if (new Set(group.map((album) => album.provider)).size > 1) {
      return [group];
    }
    return group.map((album) => [album]);
  });
};

const mergeMusicSourceTracks = (
  albums: FetchedMusicSourceAlbum[],
  albumTitle: string,
) => {
  const trackNumbers = Array.from(
    new Set(
      albums.flatMap((album) => album.tracks.map((track) => track.trackNo)),
    ),
  ).sort((a, b) => a - b);

  return trackNumbers.map((trackNo) => {
    const entries = albums
      .map((album) => ({
        provider: album.provider,
        track: album.tracks.find((track) => track.trackNo === trackNo),
      }))
      .filter(
        (entry): entry is { provider: MusicSourceProvider; track: MusicSourceTrackData } =>
          Boolean(entry.track),
      );

    if (entries.length !== albums.length) {
      throw new ReviewDocsInputError(
        `${albumTitle} ${trackNo}번 트랙이 멜론/지니 중 한쪽에만 있습니다.`,
      );
    }

    const title = pickVerifiedText(
      `${albumTitle} ${trackNo}번 트랙명`,
      entries.map((entry) => ({
        provider: entry.provider,
        value: entry.track.trackTitle,
      })),
    );
    const isInstrumental = isInstrumentalTitle(title);
    const lyrics = isInstrumental
      ? pickPreferredText(
          entries.map((entry) => ({
            provider: entry.provider,
            value: entry.track.lyrics,
          })),
        )
      : pickVerifiedText(
          `${albumTitle} ${trackNo}번 가사`,
          entries.map((entry) => ({
            provider: entry.provider,
            value: entry.track.lyrics,
          })),
          normalizeLyricsForCompare,
        );
    const sourceNotes = entries
      .map((entry) => `${SOURCE_LABELS[entry.provider]} 곡 ID: ${entry.track.songId}`)
      .join(" / ");

    return {
      ...entries[0].track,
      trackNo,
      trackTitle: title,
      artistName: pickVerifiedText(
        `${albumTitle} ${trackNo}번 아티스트`,
        entries.map((entry) => ({
          provider: entry.provider,
          value: entry.track.artistName,
        })),
        normalizeArtistForCompare,
      ),
      isTitle: entries.some((entry) => entry.track.isTitle),
      composer: pickVerifiedText(
        `${albumTitle} ${trackNo}번 작곡자`,
        entries.map((entry) => ({
          provider: entry.provider,
          value: entry.track.composer,
        })),
        normalizeContributorForCompare,
      ),
      lyricist: pickVerifiedText(
        `${albumTitle} ${trackNo}번 작사자`,
        entries.map((entry) => ({
          provider: entry.provider,
          value: entry.track.lyricist,
        })),
        normalizeContributorForCompare,
      ),
      arranger: pickVerifiedText(
        `${albumTitle} ${trackNo}번 편곡자`,
        entries.map((entry) => ({
          provider: entry.provider,
          value: entry.track.arranger,
        })),
        normalizeContributorForCompare,
      ),
      lyrics,
      songId: entries.map((entry) => `${entry.provider}:${entry.track.songId}`).join("+"),
      songUrl: entries.map((entry) => entry.track.songUrl).join("\n"),
      sourceNotes,
    } satisfies MusicSourceTrackData;
  });
};

const mergeMusicSourceAlbums = (albums: FetchedMusicSourceAlbum[]) => {
  if (albums.length === 1) {
    const album = albums[0];
    return {
      ...album,
      tracks: album.tracks.map((track) => ({
        ...track,
        sourceNotes: `${SOURCE_LABELS[album.provider]} 곡 ID: ${track.songId}`,
      })),
    } satisfies MusicSourceAlbumData;
  }

  const albumTitle = pickVerifiedText(
    "앨범명",
    albums.map((album) => ({
      provider: album.provider,
      value: album.albumTitle,
    })),
  );
  const tracks = mergeMusicSourceTracks(albums, albumTitle);

  return {
    ...albums[0],
    albumId: albums.map((album) => `${album.provider}-${album.albumId}`).join("+"),
    albumUrl: albums.map((album) => album.albumUrl).join("\n"),
    albumTitle,
    albumType: pickPreferredText(
      albums.map((album) => ({
        provider: album.provider,
        value: album.albumType,
      })),
    ),
    artistName: pickVerifiedText(
      `${albumTitle} 앨범 아티스트`,
      albums.map((album) => ({
        provider: album.provider,
        value: album.artistName,
      })),
      normalizeArtistForCompare,
    ),
    releaseDate: pickVerifiedText(
      `${albumTitle} 발매일`,
      albums.map((album) => ({
        provider: album.provider,
        value: album.releaseDate,
      })),
    ),
    genre: pickPreferredText(
      albums.map((album) => ({
        provider: album.provider,
        value: album.genre,
      })),
    ),
    distributor: pickVerifiedText(
      `${albumTitle} 발매사`,
      albums.map((album) => ({
        provider: album.provider,
        value: album.distributor,
      })),
      normalizeCompanyForCompare,
    ),
    productionCompany: pickVerifiedText(
      `${albumTitle} 기획사`,
      albums.map((album) => ({
        provider: album.provider,
        value: album.productionCompany,
      })),
      normalizeCompanyForCompare,
    ),
    tracks,
  } satisfies MusicSourceAlbumData;
};

const assertFinalLyricsAvailable = (album: MusicSourceAlbumData) => {
  const missingLyrics = album.tracks.filter(
    (track) => !isInstrumentalTitle(track.trackTitle) && !track.lyrics.trim(),
  );
  if (missingLyrics.length === 0) return;

  throw new ReviewDocsInputError(
    `${album.albumTitle}: 가사를 가져오지 못한 곡이 있습니다: ${missingLyrics
      .map((track) => `${track.trackNo}. ${track.trackTitle}`)
      .join(", ")}. 멜론/지니 모두에 실제 가사가 있는지 확인해주세요.`,
  );
};

const sourceTrackToRecord = (
  submissionId: string,
  track: MusicSourceTrackData,
  existing?: DbRecord,
): DbRecord => ({
  ...(existing ?? {}),
  submission_id: getText(existing ?? {}, "submission_id") || submissionId,
  track_no: getNumber(existing ?? {}, "track_no") ?? track.trackNo,
  track_title: withFallback(existing?.track_title, track.trackTitle),
  composer: withFallback(existing?.composer, track.composer),
  lyricist: withFallback(existing?.lyricist, track.lyricist),
  arranger: withFallback(existing?.arranger, track.arranger),
  performer: withFallback(existing?.performer ?? existing?.performers, track.artistName),
  lyrics: withFallback(existing?.lyrics, track.lyrics),
  notes: getText(existing ?? {}, "notes") || track.sourceNotes || `음원 곡 ID: ${track.songId}`,
  is_title: existing?.is_title === true || track.isTitle,
  title_role:
    getText(existing ?? {}, "title_role") || (track.isTitle ? "MAIN" : null),
  broadcast_selected: existing?.broadcast_selected === true || track.isTitle,
});

const melonTrackToRecord = (
  submissionId: string,
  track: MelonTrackReviewData,
  existing?: DbRecord,
) =>
  sourceTrackToRecord(
    submissionId,
    {
      ...track,
      sourceNotes: `멜론 곡 ID: ${track.songId}`,
    },
    existing,
  );

async function hydrateOneClickMelonBundle(
  bundle: ReviewDocSubmissionBundle,
): Promise<ReviewDocSubmissionBundle> {
  if (!shouldHydrateFromMelon(bundle)) return bundle;

  const melonUrl = getText(bundle.submission, "melon_url");
  try {
    const melonAlbum = await fetchMelonAlbumReviewData(melonUrl, {
      requireLyrics: true,
    });
    const submissionId = getText(bundle.submission, "id");
    const existingByTrackNo = new Map(
      bundle.tracks.map((track, index) => [
        getNumber(track, "track_no") ?? index + 1,
        track,
      ]),
    );

    return {
      ...bundle,
      submission: {
        ...bundle.submission,
        title: withFallback(bundle.submission.title, melonAlbum.albumTitle),
        artist_name: withFallback(
          bundle.submission.artist_name,
          melonAlbum.artistName,
        ),
        release_date: withFallback(
          bundle.submission.release_date,
          melonAlbum.releaseDate,
        ),
        genre: withFallback(bundle.submission.genre, melonAlbum.genre),
        distributor: withFallback(
          bundle.submission.distributor,
          melonAlbum.distributor,
        ),
        production_company: withFallback(
          bundle.submission.production_company,
          melonAlbum.productionCompany,
        ),
      },
      tracks: melonAlbum.tracks.map((track) =>
        melonTrackToRecord(submissionId, track, existingByTrackNo.get(track.trackNo)),
      ),
    };
  } catch (error) {
    if (error instanceof MelonReviewDataError) {
      throw new ReviewDocsDataError(error.message);
    }
    throw error;
  }
}

export async function buildMelonReviewDocSubmissionBundles(
  melonUrls: string[],
  options: MelonFetchOptions = {},
): Promise<ReviewDocSubmissionBundle[]> {
  const uniqueUrls = Array.from(
    new Set(melonUrls.map((url) => url.trim()).filter(Boolean)),
  );
  if (uniqueUrls.length === 0) {
    throw new ReviewDocsInputError("멜론 링크를 1개 이상 입력해주세요.");
  }

  const albums = await Promise.all(
    uniqueUrls.map(async (melonUrl, index) => {
      try {
        return await fetchMelonAlbumReviewData(melonUrl, {
          ...options,
          requireLyrics: true,
        });
      } catch (error) {
        if (error instanceof MelonReviewDataError) {
          throw new ReviewDocsInputError(
            `${index + 1}번째 멜론 링크: ${error.message}`,
          );
        }
        throw error;
      }
    }),
  );

  return albums.map((album) => {
    const submissionId = `melon-${album.albumId}`;
    return {
      submission: {
        id: submissionId,
        type: "ALBUM",
        is_oneclick: false,
        melon_url: album.albumUrl,
        title: album.albumTitle,
        artist_name: album.artistName,
        release_date: album.releaseDate,
        genre: album.genre,
        distributor: album.distributor,
        production_company: album.productionCompany,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      tracks: album.tracks.map((track) => melonTrackToRecord(submissionId, track)),
      files: [],
      events: [],
    };
  });
}

async function fetchMusicSourceAlbum(
  url: string,
  index: number,
  options: ExternalReviewDocFetchOptions,
  requireLyrics: boolean,
): Promise<FetchedMusicSourceAlbum> {
  const provider = sourceKindFromUrl(url);
  if (!provider) {
    throw new ReviewDocsInputError(
      `${index + 1}번째 링크: 멜론 또는 지니 앨범 링크를 입력해주세요.`,
    );
  }

  try {
    if (provider === "genie") {
      const album = await fetchGenieAlbumReviewData(url, {
        ...options,
        requireLyrics,
      });
      return {
        ...album,
        provider,
        sourceIndex: index,
        sourceInput: url,
      };
    }

    const album = await fetchMelonAlbumReviewData(url, {
      ...options,
      requireLyrics,
    });
    return {
      ...album,
      provider,
      sourceIndex: index,
      sourceInput: url,
    };
  } catch (error) {
    if (error instanceof MelonReviewDataError || error instanceof GenieReviewDataError) {
      throw new ReviewDocsInputError(
        `${index + 1}번째 ${SOURCE_LABELS[provider]} 링크: ${error.message}`,
      );
    }
    throw error;
  }
}

export async function buildExternalReviewDocSubmissionBundles(
  urls: string[],
  options: ExternalReviewDocFetchOptions = {},
): Promise<ReviewDocSubmissionBundle[]> {
  const uniqueUrls = Array.from(new Set(urls.map((url) => url.trim()).filter(Boolean)));
  if (uniqueUrls.length === 0) {
    throw new ReviewDocsInputError("멜론 또는 지니 앨범 링크를 1개 이상 입력해주세요.");
  }

  const hasCrossSourceFallback =
    new Set(uniqueUrls.map(sourceKindFromUrl).filter(Boolean)).size > 1;
  const fetchedAlbums = await Promise.all(
    uniqueUrls.map((url, index) =>
      fetchMusicSourceAlbum(url, index, options, !hasCrossSourceFallback),
    ),
  );
  const albums = groupFetchedMusicAlbums(fetchedAlbums).map(mergeMusicSourceAlbums);
  albums.forEach(assertFinalLyricsAvailable);

  return albums.map((album) => {
    const submissionId = `external-${album.albumId}`;
    const sourceUrls = album.albumUrl.split("\n").filter(Boolean);
    return {
      submission: {
        id: submissionId,
        type: "ALBUM",
        is_oneclick: false,
        melon_url: sourceUrls.find((url) => url.includes("melon.com")) ?? "",
        genie_url: sourceUrls.find((url) => url.includes("genie.co.kr")) ?? "",
        external_source_urls: sourceUrls.join("\n"),
        title: album.albumTitle,
        artist_name: album.artistName,
        release_date: album.releaseDate,
        genre: album.genre,
        distributor: album.distributor,
        production_company: album.productionCompany,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      tracks: album.tracks.map((track) => sourceTrackToRecord(submissionId, track)),
      files: [],
      events: [],
    };
  });
}

async function zipToBuffer(zip: ZipFile) {
  const chunks: Buffer[] = [];
  return new Promise<Buffer>((resolve, reject) => {
    zip.outputStream.on("data", (chunk: Buffer | Uint8Array | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    zip.outputStream.once("error", reject);
    zip.outputStream.once("end", () => resolve(Buffer.concat(chunks)));
    zip.end();
  });
}

export async function loadReviewDocSubmissionBundles(
  supabase: SupabaseClient,
  ids: string[],
) {
  const uniqueIds = Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)));
  if (uniqueIds.length === 0) {
    throw new ReviewDocsNotFoundError("선택된 접수가 없습니다.");
  }

  const { data: submissions, error: submissionsError } = await supabase
    .from("submissions")
    .select("*")
    .in("id", uniqueIds);

  if (submissionsError) {
    throw new ReviewDocsDataError(
      `신청 데이터를 불러오지 못했습니다. ${submissionsError.message}`,
    );
  }

  const submissionRows = (submissions ?? []) as DbRecord[];
  const byId = new Map(submissionRows.map((submission) => [getText(submission, "id"), submission]));
  const missing = uniqueIds.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    throw new ReviewDocsNotFoundError("선택한 접수 중 찾을 수 없는 항목이 있습니다.");
  }

  const orderedSubmissions = uniqueIds.map((id) => byId.get(id)).filter(Boolean) as DbRecord[];
  const unsupported = orderedSubmissions.filter(
    (submission) =>
      getText(submission, "type") !== "ALBUM" ||
      getBoolean(submission, "is_oneclick"),
  );
  if (unsupported.length > 0) {
    throw new ReviewDocsUnsupportedTypeError();
  }

  const [tracksResult, filesResult, eventsResult] = await Promise.all([
    supabase
      .from("album_tracks")
      .select("*")
      .in("submission_id", uniqueIds)
      .order("track_no", { ascending: true }),
    supabase.from("submission_files").select("*").in("submission_id", uniqueIds),
    supabase
      .from("submission_events")
      .select("*")
      .in("submission_id", uniqueIds)
      .order("created_at", { ascending: false }),
  ]);

  if (tracksResult.error) {
    throw new ReviewDocsDataError(
      `트랙 데이터를 불러오지 못했습니다. ${tracksResult.error.message}`,
    );
  }

  if (filesResult.error) {
    console.warn("[review-docs] submission_files load skipped", filesResult.error);
  }
  if (eventsResult.error) {
    console.warn("[review-docs] submission_events load skipped", eventsResult.error);
  }

  const tracks = ((tracksResult.data ?? []) as DbRecord[]).reduce(
    (map, track) => {
      const submissionId = getText(track, "submission_id");
      const list = map.get(submissionId) ?? [];
      list.push(track);
      map.set(submissionId, list);
      return map;
    },
    new Map<string, DbRecord[]>(),
  );
  const files = ((filesResult.data ?? []) as DbRecord[]).reduce(
    (map, file) => {
      const submissionId = getText(file, "submission_id");
      const list = map.get(submissionId) ?? [];
      list.push(file);
      map.set(submissionId, list);
      return map;
    },
    new Map<string, DbRecord[]>(),
  );
  const events = ((eventsResult.data ?? []) as DbRecord[]).reduce(
    (map, event) => {
      const submissionId = getText(event, "submission_id");
      const list = map.get(submissionId) ?? [];
      list.push(event);
      map.set(submissionId, list);
      return map;
    },
    new Map<string, DbRecord[]>(),
  );

  return orderedSubmissions.map((submission) => {
    const id = getText(submission, "id");
    return {
      submission,
      tracks: tracks.get(id) ?? [],
      files: files.get(id) ?? [],
      events: events.get(id) ?? [],
    };
  });
}

export async function recordReviewDocsGeneratedEvents({
  supabase,
  submissionIds,
  actorUserId,
  mode,
}: {
  supabase: SupabaseClient;
  submissionIds: string[];
  actorUserId: string;
  mode: "single" | "bulk";
}) {
  const ids = Array.from(
    new Set(submissionIds.map((id) => id.trim()).filter(Boolean)),
  );
  if (ids.length === 0) return;

  try {
    const { error } = await supabase.from("submission_events").insert(
      ids.map((submissionId) => ({
        submission_id: submissionId,
        actor_user_id: actorUserId,
        event_type: "REVIEW_DOCS_GENERATED",
        message:
          mode === "bulk"
            ? `관리자가 선택 ${ids.length}건의 심의자료 DOCX ZIP을 생성했습니다.`
            : "관리자가 심의자료 DOCX ZIP을 생성했습니다.",
      })),
    );

    if (error) {
      console.warn("[review-docs] audit event insert skipped", {
        code: error.code,
        message: error.message,
        submissionCount: ids.length,
      });
    }
  } catch (error) {
    console.warn("[review-docs] audit event insert skipped", {
      message: error instanceof Error ? error.message : "unknown error",
      submissionCount: ids.length,
    });
  }
}

export async function buildReviewDocsZip(
  bundles: ReviewDocSubmissionBundle[],
  options: { templateDir?: string } = {},
) {
  if (bundles.length === 0) {
    throw new ReviewDocsNotFoundError("선택된 접수가 없습니다.");
  }

  const templates = await loadReviewDocTemplates(options.templateDir);
  const hydratedBundles = await Promise.all(
    bundles.map((bundle) => hydrateOneClickMelonBundle(bundle)),
  );
  const zip = new ZipFile();
  const usedPaths = new Set<string>();
  const renderTemplate = (
    key: ReviewDocTemplateKey,
    data: Record<string, unknown>,
  ) => {
    try {
      return renderReviewDocTemplate({
        template: templates[key],
        templateName: REVIEW_DOC_TEMPLATE_FILES[key],
        data: data as Record<string, ReviewDocTemplateValue>,
      });
    } catch (error) {
      if (error instanceof ReviewDocTemplateRenderError) {
        throw new ReviewDocsRenderError(error.message);
      }
      throw error;
    }
  };

  hydratedBundles.forEach((bundle, index) => {
    const base = buildSubmissionTemplateData(bundle, index, hydratedBundles.length);
    const folder = uniquePath(
      sanitizeFilenamePart(
        `${base.artist_name} - ${base.album_title}`,
        "album",
      ),
      usedPaths,
    );
    const reviewFormData = withDocumentContext(base, {
      document_title: "심의자료",
      document_kind: "review-form",
      company_name: REVIEW_COMPANY,
      planning_company: REVIEW_COMPANY,
      production_company: REVIEW_COMPANY,
      agency_company: REVIEW_COMPANY,
      label_company: REVIEW_COMPANY,
    });
    const albumInfoData = withDocumentContext(base, {
      document_title: "앨범정보",
      document_kind: "album-info",
      company_name: base.actual_company,
      planning_company: base.actual_company,
      production_company: base.actual_company,
      agency_company: base.actual_company,
      label_company: base.actual_company,
    });
    const fileBase = sanitizeFilenamePart(
      `${base.artist_name} - ${base.album_title}`,
      "album",
    );

    zip.addBuffer(
      renderTemplate("songReviewRequest", base),
      uniquePath(`${folder}/가요심의요청서_${fileBase}.docx`, usedPaths),
    );
    zip.addBuffer(
      renderTemplate("reviewForm", reviewFormData),
      uniquePath(`${folder}/심의폼_${fileBase}.docx`, usedPaths),
    );
    zip.addBuffer(
      renderTemplate("reviewForm", albumInfoData),
      uniquePath(`${folder}/앨범정보_${fileBase}.docx`, usedPaths),
    );
    zip.addBuffer(
      renderTemplate("lyricsAll", base),
      uniquePath(`${folder}/가사전체파일_${fileBase}.docx`, usedPaths),
    );

    base.tracks.forEach((track) => {
      const trackTitle = sanitizeFilenamePart(
        `${track.track_no_padded}_${track.track_title_for_filename}`,
        `track_${track.track_no_padded}`,
      );
      zip.addBuffer(
        renderTemplate("lyricsTrack", {
          ...base,
          ...track,
          track,
        }),
        uniquePath(`${folder}/${trackTitle}.docx`, usedPaths),
      );
    });
  });

  const integratedFolder = "통합신청서";
  const integratedData = hydratedBundles.map((bundle, index) =>
    buildSubmissionTemplateData(bundle, index, hydratedBundles.length),
  );
  const albums = integratedData.map((album, index) => ({
    ...album,
    row_no: index + 1,
  }));
  const integratedBase = {
    generated_at: integratedData[0]?.generated_at ?? formatDateTime(new Date().toISOString()),
    today_year: integratedData[0]?.today_year ?? "",
    today_md: integratedData[0]?.today_md ?? "",
    submission_count: albums.length,
    album_count: albums.length,
    track_count: albums.reduce((sum, album) => sum + album.track_count, 0),
    albums,
    submissions: albums,
    tracks: albums.flatMap((album) =>
      album.tracks.map((track) => ({
        ...track,
        album_title: album.album_title,
        artist_display: album.artist_display,
      })),
    ),
  };

  zip.addBuffer(
    renderTemplate("tbsIntegrated", {
      ...integratedBase,
      station_code: "TBS",
      station_name: "TBS",
    }),
    uniquePath(`${integratedFolder}/TBS신청서_통합.docx`, usedPaths),
  );
  zip.addBuffer(
    renderTemplate("wbsIntegrated", {
      ...integratedBase,
      station_code: "WBS",
      station_name: "WBS",
    }),
    uniquePath(`${integratedFolder}/WBS신청서_통합.docx`, usedPaths),
  );
  zip.addBuffer(
    renderTemplate("pbcIntegrated", {
      ...integratedBase,
      station_code: "PBC",
      station_name: "PBC",
    }),
    uniquePath(`${integratedFolder}/PBC신청서_통합.docx`, usedPaths),
  );

  return zipToBuffer(zip);
}

export function buildReviewDocsZipFilename(bundles: ReviewDocSubmissionBundle[]) {
  const today = seoulTodayParts();
  const date = `${today.year}-${two(today.month)}-${two(today.day)}`;
  if (bundles.length === 1) {
    const submission = bundles[0].submission;
    const title = sanitizeFilenamePart(getText(submission, "title"), "submission");
    return `심의자료_${title}_${date}.zip`;
  }
  return `심의자료_${bundles.length}건_${date}.zip`;
}

export function contentDispositionAttachment(filename: string) {
  const asciiFallback = filename.replace(/[^\x20-\x7e]/g, "_");
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(
    filename,
  )}`;
}

export function getReviewDocsErrorPayload(error: unknown) {
  if (
    error instanceof ReviewDocsTemplateMissingError ||
    error instanceof ReviewDocsDataError ||
    error instanceof ReviewDocsNotFoundError ||
    error instanceof ReviewDocsInputError ||
    error instanceof ReviewDocsUnsupportedTypeError ||
    error instanceof ReviewDocsRenderError
  ) {
    return {
      status: error.status,
      body: {
        error: error.message,
        missing:
          error instanceof ReviewDocsTemplateMissingError ? error.missing : undefined,
      },
    };
  }

  return {
    status: 500,
    body: { error: "심의자료 ZIP 파일을 생성할 수 없습니다." },
  };
}
