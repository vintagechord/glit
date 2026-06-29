import { access } from "node:fs/promises";
import path from "node:path";

import type { SupabaseClient } from "@supabase/supabase-js";
import { ZipFile } from "yazl";

import { formatDate, formatDateTime } from "@/lib/format";
import {
  createLyricsAllDocx,
  createLyricsTrackDocx,
  createPbcIntegratedDocx,
  createReviewFormDocx,
  createSongReviewRequestDocx,
  createTbsIntegratedDocx,
  createWbsIntegratedDocx,
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
  email: "myonside@daum.net",
} as const;

const REVIEW_COMPANY = "빈티지코드";

export type ReviewDocSubmissionBundle = {
  submission: DbRecord;
  tracks: DbRecord[];
  files: DbRecord[];
  events: DbRecord[];
};

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

async function assertTemplatesAvailable() {
  const entries = Object.values(REVIEW_DOC_TEMPLATE_FILES);
  const checks = await Promise.all(
    entries.map(async (filename) => {
      const filePath = path.join(TEMPLATE_DIR, filename);
      try {
        await access(filePath);
        return null;
      } catch {
        return filename;
      }
    }),
  );
  const missing: string[] = [];
  checks.forEach((filename) => {
    if (filename) {
      missing.push(filename);
    }
  });
  if (missing.length > 0) {
    throw new ReviewDocsTemplateMissingError(missing);
  }
}

const valueToText = (value: unknown) => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
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

const toDateParts = (value?: string | null) => {
  if (!value) return null;
  const text = value.trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    return {
      year: Number(match[1]),
      month: Number(match[2]),
      day: Number(match[3]),
    };
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
  `${parts.year}년  ${two(parts.month)}월  ${two(parts.day)}일`;

const formatLongDot = (parts: ReturnType<typeof seoulTodayParts> | null) =>
  parts ? `${parts.year}. ${two(parts.month)}. ${two(parts.day)}.` : "";

const formatShortDot = (parts: ReturnType<typeof seoulTodayParts> | null) =>
  parts ? `${String(parts.year).slice(-2)}.${two(parts.month)}.${two(parts.day)}` : "";

const formatMonthDay = (parts: ReturnType<typeof seoulTodayParts> | null) =>
  parts ? `${two(parts.month)}/${two(parts.day)}` : "";

const isInstrumentalTitle = (title: string) =>
  /\b(inst|instrumental|mr)\b/i.test(title) || /반주|가사\s*없음/i.test(title);

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
  if (!translated) return base;
  if (!base) return translated;
  if (base.includes("번역 :") || base.includes("번역:")) return base;
  return `${base}\n\n번역 가사\n${translated}`;
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
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
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
  const isInstrumental = isInstrumentalTitle(title) || !lyrics.trim();
  const lyricist = getText(track, "lyricist");
  const lyricsDisplay = isInstrumental
    ? "가사 없음 / Instrumental"
    : appendTranslatedLyrics(lyrics, translatedLyrics);

  return {
    ...normalizeRecord(track),
    index: index + 1,
    track_no: trackNo,
    track_no_padded: String(trackNo).padStart(2, "0"),
    track_title: title,
    track_title_for_docs: isTitle ? `${title} (타이틀)` : title,
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
    translated_lyrics: translatedLyrics,
    notes: getText(track, "notes"),
    is_title: isTitle,
    is_title_label: booleanLabel(isTitle),
    title_marker: isTitle ? "타이틀" : "",
    title_role: getText(track, "title_role"),
    broadcast_selected: broadcastSelected,
    broadcast_selected_label: booleanLabel(broadcastSelected),
    is_instrumental: isInstrumental,
  };
};

function buildSubmissionTemplateData(
  bundle: ReviewDocSubmissionBundle,
  index: number,
  totalCount: number,
) {
  const submission = bundle.submission;
  const rawReleaseDate = getText(submission, "release_date");
  const title = getText(submission, "title") || "제목 미입력";
  const artistName =
    getText(submission, "artist_name") ||
    getText(submission, "artist_name_kr") ||
    getText(submission, "artist_name_en") ||
    "아티스트 미입력";
  const productionCompany = getText(submission, "production_company");
  const distributor = getText(submission, "distributor");
  const actualCompany = productionCompany;
  const tracks = bundle.tracks
    .slice()
    .sort((a, b) => {
      const aNo = getNumber(a, "track_no") ?? Number.MAX_SAFE_INTEGER;
      const bNo = getNumber(b, "track_no") ?? Number.MAX_SAFE_INTEGER;
      return aNo - bNo;
    })
    .map(normalizeTrack);
  const files = bundle.files.map(normalizeRecord);
  const events = bundle.events.map(normalizeRecord);
  const applicantName = getText(submission, "applicant_name");
  const applicantEmail = getText(submission, "applicant_email");
  const applicantPhone = getText(submission, "applicant_phone");
  const guestName = getText(submission, "guest_name");
  const guestCompany = getText(submission, "guest_company");
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
    artist_name_kr: getText(submission, "artist_name_kr"),
    artist_name_en: getText(submission, "artist_name_en"),
    today_long: formatLongKorean(todayParts),
    today_year: String(todayParts.year),
    today_mmdd: formatMonthDay(todayParts),
    release_date: rawReleaseDate ? formatDate(rawReleaseDate) : "",
    release_date_long: formatLongDot(releaseParts),
    release_date_short: formatShortDot(releaseParts),
    release_date_mmdd: formatMonthDay(releaseParts),
    production_date_long: formatLongDot(productionParts),
    production_date_short: formatShortDot(productionParts),
    release_date_raw: rawReleaseDate,
    genre: getText(submission, "genre"),
    genre_checkbox_line: getGenreCheckboxLine(getText(submission, "genre")),
    distributor,
    production_company: productionCompany,
    actual_company: actualCompany,
    review_company: REVIEW_COMPANY,
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
    tracks,
    title_tracks: titleTracks,
    broadcast_tracks: tracks.filter((track) => track.broadcast_selected),
    track_count: tracks.length,
    track_count_label: `${tracks.length}곡`,
    title_track_title: integratedTitleTrack?.track_title ?? "",
    integrated_song_titles: integratedSongTitles,
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
    (submission) => getText(submission, "type") !== "ALBUM",
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

export async function buildReviewDocsZip(bundles: ReviewDocSubmissionBundle[]) {
  if (bundles.length === 0) {
    throw new ReviewDocsNotFoundError("선택된 접수가 없습니다.");
  }

  await assertTemplatesAvailable();
  const zip = new ZipFile();
  const usedPaths = new Set<string>();

  bundles.forEach((bundle, index) => {
    const base = buildSubmissionTemplateData(bundle, index, bundles.length);
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
      createSongReviewRequestDocx(base as Parameters<typeof createSongReviewRequestDocx>[0]),
      uniquePath(`${folder}/가요심의요청서_${fileBase}.docx`, usedPaths),
    );
    zip.addBuffer(
      createReviewFormDocx(
        reviewFormData as Parameters<typeof createReviewFormDocx>[0],
        "심의폼",
      ),
      uniquePath(`${folder}/심의폼_${fileBase}.docx`, usedPaths),
    );
    zip.addBuffer(
      createReviewFormDocx(
        albumInfoData as Parameters<typeof createReviewFormDocx>[0],
        "앨범정보",
      ),
      uniquePath(`${folder}/앨범정보_${fileBase}.docx`, usedPaths),
    );
    zip.addBuffer(
      createLyricsAllDocx(base as Parameters<typeof createLyricsAllDocx>[0]),
      uniquePath(`${folder}/가사전체파일_${fileBase}.docx`, usedPaths),
    );

    base.tracks.forEach((track) => {
      const trackTitle = sanitizeFilenamePart(
        `${track.track_no_padded}_${track.track_title_for_filename}`,
        `track_${track.track_no_padded}`,
      );
      zip.addBuffer(
        createLyricsTrackDocx(
          base as Parameters<typeof createLyricsTrackDocx>[0],
          track as Parameters<typeof createLyricsTrackDocx>[1],
        ),
        uniquePath(`${folder}/${trackTitle}.docx`, usedPaths),
      );
    });
  });

  const integratedFolder = "통합신청서";
  const integratedData = bundles.map((bundle, index) =>
    buildSubmissionTemplateData(bundle, index, bundles.length),
  ) as Array<Parameters<typeof createTbsIntegratedDocx>[0][number]>;

  zip.addBuffer(
    createTbsIntegratedDocx(integratedData),
    uniquePath(`${integratedFolder}/TBS신청서_통합.docx`, usedPaths),
  );
  zip.addBuffer(
    createWbsIntegratedDocx(integratedData),
    uniquePath(`${integratedFolder}/WBS신청서_통합.docx`, usedPaths),
  );
  zip.addBuffer(
    createPbcIntegratedDocx(integratedData),
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
