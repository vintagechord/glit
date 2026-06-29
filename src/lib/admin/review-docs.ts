import { access, readFile } from "node:fs/promises";
import path from "node:path";

import type { SupabaseClient } from "@supabase/supabase-js";
import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";
import { ZipFile } from "yazl";

import { formatDate, formatDateTime } from "@/lib/format";

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

type TemplateKey = keyof typeof REVIEW_DOC_TEMPLATE_FILES;
type DbRecord = Record<string, unknown>;

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

async function loadTemplates(): Promise<Record<TemplateKey, Buffer>> {
  await assertTemplatesAvailable();

  const entries = await Promise.all(
    Object.entries(REVIEW_DOC_TEMPLATE_FILES).map(async ([key, filename]) => {
      const filePath = path.join(TEMPLATE_DIR, filename);
      return [key, await readFile(filePath)] as const;
    }),
  );

  return Object.fromEntries(entries) as Record<TemplateKey, Buffer>;
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

  return {
    ...normalizeRecord(track),
    index: index + 1,
    track_no: trackNo,
    track_no_padded: String(trackNo).padStart(2, "0"),
    track_title: title,
    title,
    display_title: title,
    featuring: getText(track, "featuring"),
    composer: getText(track, "composer"),
    lyricist: getText(track, "lyricist"),
    arranger: getText(track, "arranger"),
    lyrics: getText(track, "lyrics"),
    translated_lyrics: getText(track, "translated_lyrics"),
    notes: getText(track, "notes"),
    is_title: isTitle,
    is_title_label: booleanLabel(isTitle),
    title_marker: isTitle ? "타이틀" : "",
    title_role: getText(track, "title_role"),
    broadcast_selected: broadcastSelected,
    broadcast_selected_label: booleanLabel(broadcastSelected),
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
  const guestCompany = getText(submission, "guest_company");
  const defaultCompany = productionCompany || distributor || guestCompany;
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
  const guestEmail = getText(submission, "guest_email");
  const guestPhone = getText(submission, "guest_phone");

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
    release_date: rawReleaseDate ? formatDate(rawReleaseDate) : "",
    release_date_raw: rawReleaseDate,
    genre: getText(submission, "genre"),
    distributor,
    production_company: productionCompany,
    company_name: defaultCompany,
    planning_company: distributor || defaultCompany,
    agency_company: productionCompany || defaultCompany,
    label_company: productionCompany || distributor || defaultCompany,
    applicant_name: applicantName,
    applicant_email: applicantEmail,
    applicant_phone: applicantPhone,
    applicant_country: getText(submission, "applicant_country"),
    guest_name: guestName,
    guest_company: guestCompany,
    guest_email: guestEmail,
    guest_phone: guestPhone,
    contact_name: applicantName || guestName,
    contact_email: applicantEmail || guestEmail,
    contact_phone: applicantPhone || guestPhone,
    tracks,
    title_tracks: tracks.filter((track) => track.is_title),
    broadcast_tracks: tracks.filter((track) => track.broadcast_selected),
    track_count: tracks.length,
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

function buildIntegratedTemplateData(
  bundles: ReviewDocSubmissionBundle[],
  stationCode: string,
  stationName: string,
) {
  const submissions = bundles.map((bundle, index) =>
    buildSubmissionTemplateData(bundle, index, bundles.length),
  );
  const tracks = submissions.flatMap((submission) =>
    submission.tracks.map((track) => ({
      ...track,
      submission_id: submission.id,
      album_title: submission.album_title,
      artist_name: submission.artist_name,
    })),
  );

  return {
    generated_at: formatDateTime(new Date().toISOString()),
    station_code: stationCode,
    station_name: stationName,
    submission_count: submissions.length,
    album_count: submissions.length,
    track_count: tracks.length,
    submissions,
    albums: submissions,
    tracks,
  };
}

function renderDocx(template: Buffer, data: DbRecord) {
  try {
    const zip = new PizZip(template);
    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      nullGetter: () => "",
    });
    doc.render(data);
    return doc.toBuffer({ compression: "DEFLATE" });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "DOCX 템플릿 렌더링 중 오류가 발생했습니다.";
    throw new ReviewDocsRenderError(`심의자료 DOCX 생성에 실패했습니다. ${message}`);
  }
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

  const templates = await loadTemplates();
  const zip = new ZipFile();
  const usedPaths = new Set<string>();

  bundles.forEach((bundle, index) => {
    const base = buildSubmissionTemplateData(bundle, index, bundles.length);
    const folder = uniquePath(
      `${String(index + 1).padStart(2, "0")}_${sanitizeFilenamePart(
        `${base.artist_name}_${base.album_title}`,
        "album",
      )}`,
      usedPaths,
    );
    const reviewFormData = withDocumentContext(base, {
      document_title: "심의자료",
      document_kind: "review-form",
      company_name: base.company_name,
      planning_company: base.distributor || base.company_name,
      production_company: base.production_company,
      agency_company: base.production_company || base.company_name,
      label_company: base.production_company || base.distributor || base.company_name,
    });
    const albumInfoData = withDocumentContext(base, {
      document_title: "앨범정보",
      document_kind: "album-info",
      company_name: base.production_company || base.distributor || base.company_name,
      planning_company: base.production_company || base.distributor || base.company_name,
      production_company: base.production_company || base.company_name,
      agency_company: base.guest_company || base.production_company || base.company_name,
      label_company: base.production_company || base.distributor || base.company_name,
    });

    zip.addBuffer(
      renderDocx(templates.songReviewRequest, base),
      uniquePath(`${folder}/음원심의신청서.docx`, usedPaths),
    );
    zip.addBuffer(
      renderDocx(templates.reviewForm, reviewFormData),
      uniquePath(`${folder}/심의자료.docx`, usedPaths),
    );
    zip.addBuffer(
      renderDocx(templates.reviewForm, albumInfoData),
      uniquePath(`${folder}/앨범정보.docx`, usedPaths),
    );
    zip.addBuffer(
      renderDocx(templates.lyricsAll, base),
      uniquePath(`${folder}/전체가사.docx`, usedPaths),
    );

    base.tracks.forEach((track) => {
      const trackData = {
        ...base,
        track,
        ...track,
      };
      const trackTitle = sanitizeFilenamePart(
        `${track.track_no_padded}_${track.track_title}`,
        `track_${track.track_no_padded}`,
      );
      zip.addBuffer(
        renderDocx(templates.lyricsTrack, trackData),
        uniquePath(`${folder}/가사_${trackTitle}.docx`, usedPaths),
      );
    });
  });

  const integratedFolder = "통합신청서";
  const integratedTemplates = [
    ["TBS", "TBS", templates.tbsIntegrated],
    ["WBS", "WBS", templates.wbsIntegrated],
    ["PBC", "PBC", templates.pbcIntegrated],
  ] as const;

  integratedTemplates.forEach(([stationCode, stationName, template]) => {
    const data = buildIntegratedTemplateData(bundles, stationCode, stationName);
    zip.addBuffer(
      renderDocx(template, data),
      uniquePath(`${integratedFolder}/${stationCode}_통합신청서.docx`, usedPaths),
    );
  });

  return zipToBuffer(zip);
}

export function buildReviewDocsZipFilename(bundles: ReviewDocSubmissionBundle[]) {
  const date = new Date().toISOString().slice(0, 10);
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
