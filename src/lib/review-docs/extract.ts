import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { z } from "zod";
import { ReviewExtractionError, validateReviewUpload } from "./upload-validation";
import { emptyReviewData, explicitInstrumental, explicitTitle, normalizeReviewDate, REVIEW_DOC_LIMITS, reviewAlbumSchema, reviewTrackSchema, type ReviewAlbum, type ReviewDocumentData, type ReviewIssue, type ReviewMode, type ReviewSource, type ReviewTrack } from "./model";

export type ReviewUpload = { id: string; name: string; mime: string; buffer: Buffer };
export { ReviewExtractionError, validateReviewUpload } from "./upload-validation";
const extractionBlockSchema = z.object({ text: z.string().max(REVIEW_DOC_LIMITS.sourceCharacters), location: z.string(), kind: z.string(), page: z.number().optional(), confidence: z.number().optional(), bbox: z.array(z.number()).optional(), cells: z.array(z.object({ text: z.string(), column: z.number(), colSpan: z.number().optional(), verticalMerge: z.string().nullable().optional() })).optional() });
const extractionResultSchema = z.object({ format: z.string(), blocks: z.array(extractionBlockSchema).max(30_000), pageCount: z.number().max(REVIEW_DOC_LIMITS.pages).optional(), warnings: z.array(z.string()).default([]) });
export type ExtractedBlocks = z.infer<typeof extractionResultSchema>;
export async function extractFileBlocks(file: ReviewUpload): Promise<ExtractedBlocks> {
  const { extension } = validateReviewUpload(file);
  const directory = await mkdtemp(path.join(os.tmpdir(), "onside-review-"));
  const input = path.join(directory, `source.${extension}`);
  await writeFile(input, file.buffer, { mode: 0o600 });
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(process.env.REVIEW_DOCS_PYTHON || "python3", [path.join(process.cwd(), "services/review-docs/extract.py"), input, extension], { stdio: ["ignore", "pipe", "pipe"], env: { NODE_ENV: process.env.NODE_ENV ?? "production", PATH: process.env.PATH, LANG: "C.UTF-8", HOME: directory, PYTHONIOENCODING: "utf-8", PYTHONNOUSERSITE: process.env.REVIEW_DOCS_PYTHON ? "1" : "0" } });
      const stdout: Buffer[] = []; let size = 0;
      const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new ReviewExtractionError("CONVERTER_TIMEOUT", "문서 변환이 90초 제한을 초과했습니다. 페이지를 나눠 다시 업로드해주세요.")); }, REVIEW_DOC_LIMITS.conversionSeconds * 1000);
      child.stdout.on("data", (chunk: Buffer) => { size += chunk.length; if (size > 12 * 1024 * 1024) { child.kill("SIGKILL"); reject(new ReviewExtractionError("EXTRACTION_LIMIT", "추출 데이터 용량 제한을 초과했습니다.")); } else stdout.push(chunk); });
      // Error output may contain source text. Never persist or log it.
      child.stderr.resume();
      child.on("error", () => { clearTimeout(timer); reject(new ReviewExtractionError("CONVERTER_UNAVAILABLE", "Python 문서 변환기를 실행할 수 없습니다. REVIEW_DOCS_PYTHON과 워커 이미지 설정을 확인해주세요.")); });
      child.on("close", (code) => {
        clearTimeout(timer);
        try {
          const result = JSON.parse(Buffer.concat(stdout).toString("utf8"));
          if (result.error) return reject(new ReviewExtractionError(String(result.error.code), String(result.error.message)));
          if (code) return reject(new ReviewExtractionError("CONVERSION_FAILED", "변환기가 비정상 종료되었습니다. 파일과 워커 메모리 제한을 확인해주세요."));
          resolve(extractionResultSchema.parse(result));
        } catch { reject(new ReviewExtractionError("CONVERSION_FAILED", "추출 결과를 검증하지 못했습니다. 변환기 의존성과 원본 문서를 확인해주세요.")); }
      });
    });
  } finally { await rm(directory, { recursive: true, force: true }); }
}

type Field = keyof ReviewAlbum | keyof ReviewTrack | "titleFlag" | "instrumental" | "trackTitle" | "albumTitle" | "trackNumber";
const labels: Record<string, Field> = {
  아티스트: "artistName", 아티스트명: "artistName", 가수: "artistName", 가수명: "artistName", artist: "artistName", artistname: "artistName",
  영문명: "artistNameEn", 영문아티스트명: "artistNameEn", 앨범명: "albumTitle", 음반명: "albumTitle", album: "albumTitle", albumtitle: "albumTitle",
  기획사: "company", 소속사: "company", 제작사: "company", 기획사제작사: "company", 기획사소속사: "company", 유통사: "distributor", 발매사: "distributor",
  발매일: "releaseDate", 발매일자: "releaseDate", 발매예정일: "releaseDate", 공개일자: "releaseDate", 제작일: "productionDate", 제작일자: "productionDate", 장르: "genre", 음반형태: "albumType", 앨범형태: "albumType",
  그룹솔로: "actType", 구성: "actType", 구성원: "members", 멤버: "members", 이전발매곡: "previousReleases", 심의요청곡수: "declaredTrackCount", 트랙수: "declaredTrackCount", 수록곡수: "declaredTrackCount",
  곡명: "trackTitle", 곡제목: "trackTitle", 노래제목: "trackTitle", title: "trackTitle", tracktitle: "trackTitle", 트랙: "trackTitle",
  트랙번호: "trackNumber", 트랙넘버: "trackNumber", 번호: "trackNumber", no: "trackNumber", trackno: "trackNumber",
  타이틀: "titleFlag", 타이틀곡: "titleFlag", 타이틀여부: "titleFlag", 작사: "lyricist", 작사가: "lyricist", 작사자: "lyricist", 작곡: "composer", 작곡가: "composer", 작곡자: "composer", 편곡: "arranger", 편곡자: "arranger", 피처링: "featuring", 피쳐링: "featuring", featuring: "featuring", feat: "featuring", 실연자: "performers", 연주자: "performers", 연주: "performers", 실연연주자: "performers",
  가사: "lyrics", 가사원문: "lyrics", 원문가사: "lyrics", lyrics: "lyrics", 번역: "existingTranslation", 한글번역: "existingTranslation", 번역가사: "existingTranslation", instmr: "instrumental", inst: "instrumental", mr: "instrumental", 연주곡: "instrumental", 반주곡: "instrumental",
};
const labelField = (value: string) => labels[value.toLowerCase().replace(/[\s:：.\-_/()[\]]/g, "")];
const trackFields = new Set<Field>(["trackTitle", "trackNumber", "titleFlag", "lyricist", "composer", "arranger", "featuring", "performers", "lyrics", "existingTranslation", "instrumental"]);

export function structureExtractedFile(source: ReviewSource, result: ExtractedBlocks, mode: ReviewMode): { albums: ReviewAlbum[]; issues: ReviewIssue[] } {
  const albums: ReviewAlbum[] = [];
  const issues: ReviewIssue[] = [];
  let album = reviewAlbumSchema.parse({ id: randomUUID(), sourceIds: [source.id], tracks: [] });
  let track: ReviewTrack | undefined;
  let activeLyrics: "lyrics" | "existingTranslation" | undefined;
  let header: (Field | undefined)[] | undefined;
  let pendingNumber: number | undefined;
  let unused = 0;
  const makeTrack = () => { const t = reviewTrackSchema.parse({ id: randomUUID(), number: pendingNumber || album.tracks.length + 1, sourceIds: [source.id] }); album.tracks.push(t); pendingNumber = undefined; return t; };
  const evidence = (target: ReviewAlbum | ReviewTrack, field: string, value: string, location: string) => target.evidence.push({ sourceId: source.id, field, location, excerpt: value.slice(0, 2000) });
  function assign(field: Field, value: string, location: string) {
    value = value.trim();
    activeLyrics = field === "lyrics" || field === "existingTranslation" ? field : undefined;
    if (field === "albumTitle") {
      if (album.title && album.title !== value) { albums.push(album); album = reviewAlbumSchema.parse({ id: randomUUID(), sourceIds: [source.id], tracks: [] }); track = undefined; header = undefined; }
      album.title = value; evidence(album, "title", value, location); return;
    }
    if (field === "trackNumber") { const number = Number.parseInt(value, 10); if (number > 0) pendingNumber = number; return; }
    if (field === "trackTitle") {
      if (!track || (track.title && track.title !== value)) track = makeTrack();
      if (pendingNumber) { track.number = pendingNumber; pendingNumber = undefined; }
      const titleMarked = /\s*[(\[]타이틀[)\]]\s*$/.test(value);
      track.title = value.replace(/\s*[(\[]타이틀[)\]]\s*$/, "");
      if (titleMarked) { track.isTitle = true; track.titleConfirmed = true; }
      if (explicitInstrumental(value)) { track.instrumentalConfirmed = true; track.lyricStatus = "instrumental"; }
      evidence(track, "title", value, location); return;
    }
    const target = trackFields.has(field) ? (track ??= makeTrack()) : album;
    if (field === "titleFlag") {
      track!.isTitle = explicitTitle(value.replace(/□|☐/g, "").trim());
      track!.titleConfirmed = track!.isTitle || /^(?:[□☐]+|x|-|아니오|아니요|no|false|0)?$/i.test(value);
      if (!track!.titleConfirmed) issues.push({ id: `title:${track!.id}:${issues.length}`, code: "TITLE_UNCERTAIN", severity: "error", albumId: album.id, trackId: track!.id, field: "isTitle", message: "타이틀 표기가 명확한 체크/미체크 값이 아닙니다. 원문을 보고 확인해주세요." });
      evidence(track!, "isTitle", value, location); return;
    }
    if (field === "instrumental") { const yes = explicitTitle(value) || explicitInstrumental(value); track!.instrumentalConfirmed = yes; if (yes) track!.lyricStatus = "instrumental"; evidence(track!, "instrumentalConfirmed", value, location); return; }
    if (field === "declaredTrackCount") { const count = Number.parseInt(value, 10); if (Number.isFinite(count)) album.declaredTrackCount = count; evidence(album, field, value, location); return; }
    if (field === "releaseDate" || field === "productionDate") value = normalizeReviewDate(value);
    const object = target as unknown as Record<string, unknown>;
    if (typeof object[field] === "string" && object[field] && object[field] !== value && value) issues.push({ id: `conflict:${target.id}:${field}:${issues.length}`, code: "FIELD_CONFLICT", severity: "error", albumId: album.id, trackId: target === track ? track?.id : undefined, sourceId: source.id, field, message: `${field} 값이 원문 내에서 충돌합니다. 근거를 비교하고 값을 선택해주세요.` });
    if (!object[field]) object[field] = value;
    evidence(target, field, value, location);
    if (field === "lyrics" && value) track!.lyricStatus = track!.instrumentalConfirmed ? "instrumental" : "provided";
  }
  for (const b of result.blocks) {
    if (b.cells) {
      const values = b.cells.map((c) => c.text.trim());
      const keys = values.map(labelField);
      if (keys.filter(Boolean).length >= 2 && keys.includes("trackTitle") && !values.some((v, i) => v && !keys[i])) { header = keys; activeLyrics = undefined; continue; }
      if (header && values.length >= header.length && !keys[0]) {
        // One repeated table row = one track. Never let a row overwrite the prior song's credits.
        track = undefined;
        const numberIndex = header.indexOf("trackNumber");
        if (numberIndex >= 0) assign("trackNumber", values[numberIndex], b.location);
        const titleIndex = header.indexOf("trackTitle");
        if (titleIndex >= 0) assign("trackTitle", values[titleIndex], b.location);
        header.forEach((f, i) => { if (f && f !== "trackTitle" && f !== "trackNumber") assign(f, values[i], `${b.location}/셀:${i+1}`); });
        activeLyrics = undefined;
        continue;
      }
      if (keys[0] && values.length > 1) {
        for (let i = 0; i < values.length - 1; i++) if (keys[i]) { assign(keys[i]!, values[i+1], `${b.location}/셀:${i+2}`); i++; }
        activeLyrics = undefined;
        continue;
      }
      activeLyrics = undefined;
    }
    for (const raw of b.text.split(/\r?\n/)) {
      const line = raw.trim();
      if (/^(?:참고|안내|담당자|연락처|이메일|신청자)\s*[:：]/.test(line)) { activeLyrics = undefined; continue; }
      const labeled = line.match(/^([^:：\t]{1,30})\s*[:：\t]\s*(.*)$/);
      if (labeled && labelField(labeled[1])) { assign(labelField(labeled[1]), labeled[2], b.location); continue; }
      const onlyLabel = labelField(line);
      if (onlyLabel === "lyrics" || onlyLabel === "existingTranslation") { assign(onlyLabel, "", b.location); continue; }
      const numbered = line.match(/^(?:트랙\s*)?(\d{1,3})[.)]\s+(.+)$/);
      if (numbered && !activeLyrics) { assign("trackNumber", numbered[1], b.location); track = undefined; assign("trackTitle", numbered[2], b.location); continue; }
      if (mode === "mv") {
        const heading = line.match(/^(.+?)\s+-\s+(.+)$/);
        if (heading && (!track || heading[1] === album.artistName || heading[1] === track.artistName)) {
          if (track?.title) track = undefined;
          if (!album.artistName) album.artistName = heading[1];
          assign("trackTitle", heading[2], b.location); track!.artistName = heading[1]; activeLyrics = "lyrics"; continue;
        }
        if (heading && activeLyrics) issues.push({ id: `mv-heading:${source.id}:${issues.length}`, code: "MV_HEADING_AMBIGUOUS", severity: "error", albumId: album.id, trackId: track?.id, sourceId: source.id, message: "아티스트 - 곡명 형식의 행이 가사 중간에 있습니다. 다른 곡의 시작인지 원문과 비교해주세요." });
      }
      if (activeLyrics && track) { track[activeLyrics] += (track[activeLyrics] ? "\n" : "") + raw.trimEnd(); if (activeLyrics === "lyrics" && line) track.lyricStatus = track.instrumentalConfirmed ? "instrumental" : "provided"; evidence(track, activeLyrics, raw, b.location); continue; }
      if (mode === "mv" && !track) {
        const heading = line.match(/^(.+?)\s+-\s+(.+)$/);
        if (heading) { if (!album.artistName) album.artistName = heading[1]; assign("trackTitle", heading[2], b.location); track!.artistName = heading[1]; activeLyrics = "lyrics"; continue; }
      }
      if (line) unused++;
    }
  }
  if (album.title || album.artistName || album.tracks.length) albums.push(album);
  if (!albums.length) issues.push({ id: `unstructured:${source.id}`, code: "STRUCTURE_REQUIRED", severity: "error", sourceId: source.id, message: "본문은 추출했지만 곡 정보를 확정하지 못했습니다. 원문을 보며 아티스트·곡명·가사를 입력해주세요." });
  if (unused) issues.push({ id: `unmapped:${source.id}`, code: "UNMAPPED_CONTENT", severity: "warning", sourceId: source.id, message: `${unused}개 원문 행이 표준 항목에 대응되지 않았습니다. 누락된 가사·트랙이 없는지 원문과 비교해주세요.` });
  if (result.warnings.some((s) => /OCR|다단|RTF|구형 Word|HWP|이미지/.test(s))) issues.push({ id: `layout:${source.id}`, code: "EXTRACTION_REVIEW", severity: "error", sourceId: source.id, message: "변환/OCR/배치 읽기 순서의 확인이 필요합니다. 원문과 아티스트·곡명·전체 가사·크레딧을 비교 후 확인해주세요." });
  return { albums, issues };
}

function mergeExactAlbums(data: ReviewDocumentData, incoming: ReviewAlbum) {
  const same = data.albums.find((a) => a.title && a.artistName && a.title.normalize("NFC") === incoming.title.normalize("NFC") && a.artistName.normalize("NFC") === incoming.artistName.normalize("NFC"));
  if (!same) { data.albums.push(incoming); return; }
  same.sourceIds = [...new Set([...same.sourceIds, ...incoming.sourceIds])]; same.evidence.push(...incoming.evidence);
  for (const field of ["company", "distributor", "releaseDate", "productionDate", "genre", "artistNameEn", "albumType", "actType", "members", "previousReleases"] as const) {
    if (!same[field]) same[field] = incoming[field];
    else if (incoming[field] && same[field] !== incoming[field]) data.issues.push({ id: `merge:${same.id}:${field}:${incoming.id}`, code: "FIELD_CONFLICT", severity: "error", albumId: same.id, field, message: `${field} 정보가 여러 원본에서 다릅니다. 근거를 비교하고 선택해주세요.` });
  }
  for (const next of incoming.tracks) {
    const existing = same.tracks.find((t) => t.number === next.number && t.title.normalize("NFC") === next.title.normalize("NFC"));
    if (!existing) { same.tracks.push(next); continue; }
    existing.sourceIds = [...new Set([...existing.sourceIds, ...next.sourceIds])]; existing.evidence.push(...next.evidence);
    for (const field of ["lyricist", "composer", "arranger", "featuring", "performers", "lyrics", "existingTranslation"] as const) {
      if (!existing[field]) { existing[field] = next[field]; if (field === "lyrics" && next[field]) existing.lyricStatus = next.lyricStatus; }
      else if (next[field] && existing[field] !== next[field]) data.issues.push({ id: `merge:${existing.id}:${field}:${next.id}`, code: "TRACK_REVISION_CONFLICT", severity: "error", albumId: same.id, trackId: existing.id, field, message: `같은 곡의 ${field} 수정본이 다릅니다. 원문 근거를 비교해 확정해주세요.` });
    }
    if (!existing.titleConfirmed && next.titleConfirmed) { existing.isTitle = next.isTitle; existing.titleConfirmed = true; }
    if (!existing.instrumentalConfirmed && next.instrumentalConfirmed) {
      if (existing.lyrics.trim()) data.issues.push({ id: `merge:${existing.id}:instrumental:${next.id}`, code: "INSTRUMENTAL_LYRIC_CONFLICT", severity: "error", albumId: same.id, trackId: existing.id, field: "instrumentalConfirmed", message: "다른 원본의 Inst./MR 표시와 가사가 충돌합니다. 원문을 비교해주세요." });
      else { existing.instrumentalConfirmed = true; existing.lyricStatus = "instrumental"; }
    }
    if (existing.isTitle !== next.isTitle && existing.titleConfirmed && next.titleConfirmed) data.issues.push({ id: `merge:${existing.id}:title:${next.id}`, code: "TITLE_CONFLICT", severity: "error", albumId: same.id, trackId: existing.id, field: "isTitle", message: "원본 사이의 타이틀 표시가 다릅니다." });
  }
  same.tracks.sort((a, b) => a.number - b.number);
}
export async function extractFiles(files: ReviewUpload[], mode: ReviewMode, applicationDate: string): Promise<ReviewDocumentData> {
  if (!files.length || files.length > REVIEW_DOC_LIMITS.files || files.reduce((n,f) => n+f.buffer.length,0) > REVIEW_DOC_LIMITS.totalBytes) throw new ReviewExtractionError("UPLOAD_LIMIT", `파일 ${REVIEW_DOC_LIMITS.files}개, 전체 ${REVIEW_DOC_LIMITS.totalBytes/1024/1024}MB까지 업로드할 수 있습니다.`);
  const data = emptyReviewData(mode, applicationDate);
  const hashes = new Set<string>();
  for (const file of files) {
    const { sha256 } = validateReviewUpload(file);
    if (hashes.has(sha256)) { data.issues.push({ id: `duplicate:${file.id}`, code: "DUPLICATE_SOURCE", severity: "warning", sourceId: file.id, message: `${file.name}: 같은 내용의 파일이 있어 중복 분석을 제외했습니다.` }); continue; }
    hashes.add(sha256);
    try {
      const result = await extractFileBlocks(file);
      const source: ReviewSource = { id: file.id, kind: "file", name: file.name, mimeType: file.mime, sha256, format: result.format, pageCount: result.pageCount, warnings: result.warnings, text: result.blocks.map((b) => `[${b.location}]\n${b.text}`).join("\n\n") };
      if (source.text.length > REVIEW_DOC_LIMITS.sourceCharacters) throw new ReviewExtractionError("TEXT_LIMIT", "원문과 근거의 전체 용량 제한을 초과했습니다. 파일을 나눠주세요.");
      if (data.sources.reduce((n, s) => n + s.text.length, 0) + source.text.length > REVIEW_DOC_LIMITS.sourceCharacters) throw new ReviewExtractionError("TOTAL_TEXT_LIMIT", "작업 전체 원문이 600,000자를 초과했습니다. 파일을 여러 작업으로 나눠주세요.");
      data.sources.push(source);
      const extracted = structureExtractedFile(source, result, mode);
      data.issues.push(...extracted.issues);
      extracted.albums.forEach((a) => mergeExactAlbums(data, a));
    } catch (error) {
      const failure = error instanceof ReviewExtractionError ? error : new ReviewExtractionError("EXTRACTION_FAILED", "파일 추출에 실패했습니다. 원본과 변환기 설정을 확인해주세요.");
      data.sources.push({ id: file.id, kind: "file", name: file.name, mimeType: file.mime, sha256, text: "", warnings: [failure.message] });
      data.issues.push({ id: `source:${file.id}`, code: failure.code, severity: "error", sourceId: file.id, message: `${file.name}: ${failure.message}` });
    }
  }
  if (data.albums.length > REVIEW_DOC_LIMITS.albums || data.albums.reduce((n, a) => n + a.tracks.length, 0) > REVIEW_DOC_LIMITS.tracks) throw new ReviewExtractionError("ALBUM_TRACK_LIMIT", "추출 결과가 앨범 8개 또는 전체 100곡 제한을 초과했습니다. 자료를 나눠주세요. 뒷부분은 생략하지 않았습니다.");
  return data;
}
