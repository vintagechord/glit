import { createHash } from "node:crypto";
import { applyArchiveCommand, type ArchiveData } from "./model";
import { ArchiveError } from "./http";

const headers = ["release_key", "release_title", "release_type", "release_date", "track_key", "track_title", "disc_number", "track_number", "version", "artist_name", "isrc", "work_key", "work_title", "writers", "iswc"];
export const archiveCsvTemplate = `${headers.join(",")}\nmy-release-1,앨범명,single,2026-09-08,my-track-1,트랙명,1,1,original,아티스트명,,,,,`;
const stableId = (kind: string, key: string) => `csv-${kind}:${createHash("sha256").update(key).digest("hex").slice(0, 40)}`;

/** RFC4180 quoted commas/newlines; deliberately capped before parsing. No spreadsheet evaluation. */
export function parseArchiveCsv(text: string): string[][] {
  if (text.length > 400000) throw new ArchiveError("CSV는 400KB까지 가능합니다.", 413);
  const records: string[][] = []; let record: string[] = []; let cell = ""; let quoted = false; let closed = false;
  const pushCell = () => { record.push(cell.trim()); cell = ""; closed = false; };
  const pushRow = () => { pushCell(); if (record.some(Boolean)) records.push(record); record = []; if (records.length > 501) throw new ArchiveError("CSV는 한 번에 500행까지 가능합니다.", 413); };
  text = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') { quoted = false; closed = true; }
      else cell += char;
    } else if (char === '"' && !cell && !closed) quoted = true;
    else if (char === ",") pushCell();
    else if (char === "\n") pushRow();
    else if (closed && char.trim()) throw new ArchiveError("CSV 따옴표 뒤의 구분자를 확인해주세요.", 422);
    else if (!closed) cell += char;
  }
  if (quoted) throw new ArchiveError("CSV의 닫히지 않은 따옴표를 확인해주세요.", 422);
  if (cell || record.length || closed) pushRow();
  return records;
}

function csvRows(csv: string, archive: ArchiveData) {
  const parsed = parseArchiveCsv(csv); const columns = parsed.shift() ?? [];
  if (["release_key", "release_title", "track_key", "track_title"].some(key => !columns.includes(key)) || new Set(columns).size !== columns.length || columns.some(key => !headers.includes(key))) throw new ArchiveError(`CSV 열을 확인해주세요. 지원 열: ${headers.join(", ")}`, 422);
  const seen = new Set<string>(); const releaseValues = new Map<string, string>(); const workValues = new Map<string, string>();
  return parsed.map((cells, index) => {
    const value = Object.fromEntries(columns.map((key, i) => [key, cells[i] ?? ""]));
    const errors: string[] = [];
    if (cells.length !== columns.length) errors.push("열 개수가 머리글과 다릅니다.");
    for (const key of ["release_key", "release_title", "track_key", "track_title"]) if (!value[key]) errors.push(`${key} 값이 필요합니다.`);
    if (Object.values(value).some(v => v.length > 500)) errors.push("각 값은 500자 이하여야 합니다.");
    if (value.release_type && !["album", "ep", "single", "other"].includes(value.release_type)) errors.push("release_type: album/ep/single/other 중 선택하세요.");
    if (value.release_date && !/^\d{4}(-\d{2})?(-\d{2})?$/.test(value.release_date)) errors.push("발매일 형식이 올바르지 않습니다.");
    for (const key of ["disc_number", "track_number"]) if (value[key] && (!/^\d+$/.test(value[key]) || +value[key] < 1 || +value[key] > 1000)) errors.push(`${key}는 1~1000 정수여야 합니다.`);
    if (value.isrc && !/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(value.isrc)) errors.push("ISRC 형식을 확인해주세요. 없는 코드는 비워두세요.");
    if (value.work_key && !value.work_title) errors.push("work_key 사용 시 work_title이 필요합니다.");
    const trackKey = `${value.release_key}\0${value.track_key}`;
    if (seen.has(trackKey)) errors.push("CSV 안에서 동일한 발매작·트랙 키가 중복됩니다.");
    seen.add(trackKey);
    const releaseValue = [value.release_title, value.release_type, value.release_date].join("\0");
    if (releaseValues.has(value.release_key) && releaseValues.get(value.release_key) !== releaseValue) errors.push("같은 release_key의 앨범 정보가 충돌합니다.");
    releaseValues.set(value.release_key, releaseValue);
    const releaseId = stableId("release", value.release_key); const trackId = stableId("track", trackKey);
    const existingRelease = archive.releases.find(release => release.id === releaseId);
    if (existingRelease && existingRelease.title !== value.release_title) errors.push("기존 release_key의 앨범명과 다릅니다. 수정값을 확인해주세요.");
    if (value.work_key) {
      const info = [value.work_title, value.writers, value.iswc].join("\0");
      if (workValues.has(value.work_key) && workValues.get(value.work_key) !== info) errors.push("같은 work_key의 저작물 정보가 충돌합니다.");
      workValues.set(value.work_key, info);
      const work = archive.works.find(item => item.id === stableId("work", value.work_key));
      if (work && [work.title, work.writers ?? "", work.iswc ?? ""].join("\0") !== info) errors.push("기존 저작물 키의 정보와 다릅니다. 직접 비교해주세요.");
    }
    const existing = archive.tracks.find(track => track.id === trackId);
    if (existing && (existing.title !== value.track_title || (existing.version ?? "") !== (value.version ?? ""))) errors.push("기존 트랙 키의 제목·버전과 다릅니다. 다른 키를 쓰거나 직접 비교해주세요.");
    return { rowNumber: index + 2, releaseTitle: value.release_title, trackTitle: value.track_title, errors, duplicate: !!existing, value, releaseId, trackId };
  });
}
export function previewArchiveCsv(csv: string, archive: ArchiveData) {
  const rows = csvRows(csv, archive);
  return { rows: rows.map(({ rowNumber, releaseTitle, trackTitle, errors, duplicate }) => ({ rowNumber, releaseTitle, trackTitle, errors, duplicate })), totalRows: rows.length, validRows: rows.filter(row => !row.errors.length && !row.duplicate).length, errorCount: rows.filter(row => row.errors.length).length, duplicateCount: rows.filter(row => row.duplicate).length };
}
export function importArchiveCsv(csv: string, input: ArchiveData) {
  const rows = csvRows(csv, input);
  if (!rows.length || rows.some(row => row.errors.length)) throw new ArchiveError("CSV 미리보기의 행별 오류를 먼저 수정해주세요.", 422);
  let data = input;
  for (const row of rows) {
    if (row.duplicate) continue;
    const v = row.value;
    if (!data.releases.some(release => release.id === row.releaseId)) data = applyArchiveCommand(data, { type: "add_release", release: { id: row.releaseId, title: v.release_title, type: v.release_type || "album", releaseDate: v.release_date || undefined, artistName: v.artist_name || data.artist.name, links: [] } });
    const recordingId = stableId("recording", `${v.release_key}\0${v.track_key}`);
    let workId: string | undefined;
    if (v.work_key) {
      workId = stableId("work", v.work_key);
      if (!data.works.some(work => work.id === workId)) data = applyArchiveCommand(data, { type: "save_work", work: { id: workId, title: v.work_title, writers: v.writers || undefined, iswc: v.iswc || undefined } });
    }
    data = applyArchiveCommand(data, { type: "save_recording", recording: { id: recordingId, title: v.track_title, version: v.version || undefined, isrc: v.isrc || undefined, workIds: workId ? [workId] : [] } });
    data = applyArchiveCommand(data, { type: "add_track", track: { id: row.trackId, releaseId: row.releaseId, title: v.track_title, discNumber: Number(v.disc_number || 1), trackNumber: Number(v.track_number || 1), version: v.version || undefined, artistName: v.artist_name || data.artist.name, recordingId, links: [] } });
  }
  return data;
}
