export type UploadKind = "audio" | "video" | "etc";

type UploadFormat = {
  /** What the object is stored and served as, whatever the browser declared. */
  contentType: string;
  /** Declared types browsers report for this extension. */
  mimes: readonly string[];
  /** Browsers and operating systems disagree on media and office types, so
   * these extensions also accept any type of the same family. */
  family?: "audio" | "video" | "document";
};

const formats: Record<string, UploadFormat> = {
  wav: { contentType: "audio/wav", mimes: [], family: "audio" },
  mp3: { contentType: "audio/mpeg", mimes: [], family: "audio" },
  m4a: { contentType: "audio/mp4", mimes: [], family: "audio" },
  aac: { contentType: "audio/aac", mimes: [], family: "audio" },
  flac: { contentType: "audio/flac", mimes: [], family: "audio" },
  zip: { contentType: "application/zip", mimes: ["multipart/x-zip"], family: "document" },
  hwp: { contentType: "application/x-hwp", mimes: [], family: "document" },
  doc: { contentType: "application/msword", mimes: [], family: "document" },
  docx: { contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", mimes: [], family: "document" },
  pdf: { contentType: "application/pdf", mimes: [], family: "document" },
  mp4: { contentType: "video/mp4", mimes: [], family: "video" },
  mov: { contentType: "video/quicktime", mimes: [], family: "video" },
  wmv: { contentType: "video/x-ms-wmv", mimes: [], family: "video" },
  mpg: { contentType: "video/mpeg", mimes: [], family: "video" },
  mpeg: { contentType: "video/mpeg", mimes: [], family: "video" },
  m4v: { contentType: "video/x-m4v", mimes: [], family: "video" },
  mxf: { contentType: "application/mxf", mimes: [], family: "video" },
  jpg: { contentType: "image/jpeg", mimes: ["image/jpeg", "image/pjpeg", "image/jpg"] },
  jpeg: { contentType: "image/jpeg", mimes: ["image/jpeg", "image/pjpeg", "image/jpg"] },
  png: { contentType: "image/png", mimes: ["image/png", "image/x-png"] },
  webp: { contentType: "image/webp", mimes: ["image/webp"] },
  gif: { contentType: "image/gif", mimes: ["image/gif"] },
  heic: { contentType: "image/heic", mimes: ["image/heic", "image/heif", "image/heic-sequence"] },
  heif: { contentType: "image/heif", mimes: ["image/heif", "image/heic", "image/heif-sequence"] },
  txt: { contentType: "text/plain; charset=utf-8", mimes: ["text/plain"] },
  lrc: { contentType: "text/plain; charset=utf-8", mimes: ["text/plain"] },
};

const applicationFormExtensions: readonly string[] = ["hwp", "doc", "docx"];

/** Extensions each submission upload kind accepts. Every one of them has a
 * container signature check, so completion never has to trust a filename. */
const kindExtensions: Record<UploadKind, ReadonlySet<string>> = {
  audio: new Set(["wav", "mp3", "zip", ...applicationFormExtensions]),
  video: new Set(["mp4", "mov", "wmv", "mpg", "mpeg", "m4v", ...applicationFormExtensions]),
  etc: new Set(["pdf", "jpg", "jpeg", "png", "webp", "txt", ...applicationFormExtensions]),
};

export type KaraokeUploadScope = "karaoke_request" | "karaoke_recommendation";

const imageExtensions: readonly string[] = ["jpg", "jpeg", "png", "webp", "gif", "heic", "heif"];

/** Extensions the karaoke forms send through /api/uploads/presign: a request
 * attaches the song or reference material, a recommendation its proof
 * screenshot (accept="image/*"). These skip the completion signature check,
 * but downloads are always attachments typed from the extension. */
const karaokeExtensions: Record<KaraokeUploadScope, ReadonlySet<string>> = {
  karaoke_request: new Set([
    "wav", "mp3", "m4a", "aac", "flac", "zip", "mp4", "mov",
    "pdf", "txt", "lrc", ...applicationFormExtensions, ...imageExtensions,
  ]),
  karaoke_recommendation: new Set(imageExtensions),
};

/** File input accept list matching a karaoke scope. */
export const karaokeUploadAccept = (scope: KaraokeUploadScope) =>
  [...karaokeExtensions[scope]].map((extension) => `.${extension}`).join(",");

export const karaokeUploadTypeError = (scope: KaraokeUploadScope) =>
  scope === "karaoke_recommendation"
    ? "추천 인증샷은 이미지 파일(JPG/PNG/WEBP/GIF/HEIC)만 업로드할 수 있습니다."
    : "음원(WAV/MP3/M4A/AAC/FLAC), 영상(MP4/MOV), 문서(PDF/HWP/DOC/DOCX/TXT/LRC), 이미지 또는 ZIP 파일만 업로드할 수 있습니다.";

const genericMimes = new Set(["", "application/octet-stream", "binary/octet-stream"]);

// Types a browser renders or runs. A document extension never carries them.
const activeApplicationMimes = new Set([
  "application/xhtml+xml",
  "application/xml",
  "application/javascript",
  "application/x-javascript",
  "application/ecmascript",
  "application/json",
  "application/hta",
  "application/x-shockwave-flash",
  "application/x-httpd-php",
  "application/x-sh",
]);

export const normalizeMimeType = (mimeType?: string | null) =>
  (mimeType ?? "").split(";", 1)[0].trim().toLowerCase();

export const uploadFileExtension = (filename?: string | null) =>
  /\.([a-z0-9]+)$/i.exec((filename ?? "").trim())?.[1].toLowerCase() ?? null;

const isDeclaredMimeCompatible = (format: UploadFormat, mimeType?: string | null) => {
  const mime = normalizeMimeType(mimeType);
  if (genericMimes.has(mime) || format.mimes.includes(mime)) return true;
  if (format.family === "audio") return mime.startsWith("audio/");
  if (format.family === "video") return mime.startsWith("video/");
  if (format.family === "document") {
    return mime.startsWith("application/") && !activeApplicationMimes.has(mime);
  }
  return false;
};

/**
 * Both the extension and the declared type must fit the kind. Accepting
 * either one alone let `a.pdf` carry `text/html`, or a name without an
 * extension skip the signature check at completion.
 */
export function isAllowedSubmissionUpload(
  kind: UploadKind,
  filename?: string | null,
  mimeType?: string | null,
) {
  const extension = uploadFileExtension(filename);
  if (!extension || !kindExtensions[kind].has(extension)) return false;
  return isDeclaredMimeCompatible(formats[extension], mimeType);
}

/** The same extension-plus-declared-type rule for the karaoke scopes. */
export function isAllowedKaraokeUpload(
  scope: KaraokeUploadScope,
  filename?: string | null,
  mimeType?: string | null,
) {
  const extension = uploadFileExtension(filename);
  if (!extension || !karaokeExtensions[scope].has(extension)) return false;
  return isDeclaredMimeCompatible(formats[extension], mimeType);
}

/** The kind a server-side upload without an explicit kind belongs to. */
export function inferSubmissionUploadKind(filename?: string | null): UploadKind | null {
  const extension = uploadFileExtension(filename);
  if (!extension) return null;
  // Application forms travel with the album audio list, as the album wizard sends them.
  if (applicationFormExtensions.includes(extension)) return "audio";
  if (kindExtensions.video.has(extension)) return "video";
  if (kindExtensions.etc.has(extension)) return "etc";
  return kindExtensions.audio.has(extension) ? "audio" : null;
}

/** Stored and served type for an object. Unknown extensions are binary. */
export function safeUploadContentType(filename?: string | null) {
  const extension = uploadFileExtension(filename);
  return (extension && formats[extension]?.contentType) || "application/octet-stream";
}

/** Served type for a download, or undefined to keep what storage recorded. */
export function knownDownloadContentType(filename?: string | null) {
  const extension = uploadFileExtension(filename);
  return extension ? formats[extension]?.contentType : undefined;
}
