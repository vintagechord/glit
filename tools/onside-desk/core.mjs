import fs from 'node:fs/promises';
import path from 'node:path';
import { createReadStream, createWriteStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import yazl from 'yazl';

export const STAGES = ['RECEIVED', 'CHECKING', 'PREPARING', 'READY', 'SUBMITTED', 'RESULT_RECEIVED', 'COMPLETED', 'ON_HOLD'];
export const DEFAULT_SETTINGS = { managerName: '정준영', managerPhone: '010-9068-9035', managerEmail: 'vintagechord@daum.net', companyName: '빈티지코드', autoSync: true, autoGenerate: false };
export const now = () => new Date().toISOString();
export const safeName = (value, fallback = '파일') => String(value || fallback).normalize('NFC').replace(/[\x00-\x1f\x7f/\\:*?"<>|]/g, '_').replace(/^\.+/, '').trim().slice(0, 110) || fallback;
export function childPath(root, ...parts) {
  const resolved = path.resolve(root, ...parts);
  if (!resolved.startsWith(path.resolve(root) + path.sep)) throw new Error('허용되지 않은 파일 경로입니다.');
  return resolved;
}
export async function atomicJSON(filename, data) {
  await fs.mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
  const temp = `${filename}.${randomUUID()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(data, null, 2), { mode: 0o600 });
  await fs.rename(temp, filename);
}
export async function sha256(filename) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
}
export async function zipFiles(destination, entries) {
  const zip = new yazl.ZipFile();
  for (const entry of entries) zip.addFile(entry.path, entry.name, { compress: !/\.(?:mp4|mov|wav|mp3|zip|docx|jpg|png)$/i.test(entry.name) });
  const writing = pipeline(zip.outputStream, createWriteStream(destination, { mode: 0o600 }));
  zip.end();
  await writing;
}
export function applyOverrides(detail, local = {}) {
  const overrides = local.overrides || {};
  return {
    ...detail,
    submission: { ...detail.submission, ...overrides.submission },
    tracks: [...(detail.tracks || []).map(track => ({ ...track, ...(overrides.tracks || []).find(item => item.id === track.id) })), ...(overrides.tracks || []).filter(t => t.id.startsWith('local-') && !(detail.tracks || []).some(track => track.id === t.id))].filter(t => !t._deleted),
  };
}
export function caseWarnings(detail, local = {}) {
  const effective = applyOverrides(detail, local);
  const s = effective.submission;
  const warnings = [...(detail.warnings || [])];
  const manual = detail.source === 'manual';
  if (!manual && s.payment_status !== 'PAID') warnings.push('결제 완료 상태가 아닙니다. 입금·결제 확인 후 접수하세요.');
  if (!manual && s.files_submitted_by_email) warnings.push('음원·영상은 이메일 전달로 표시되었습니다. 수신 여부를 확인하고 파일을 추가하세요.');
  if (!s.artist_name) warnings.push('아티스트명이 비어 있습니다.');
  if (!s.title) warnings.push('작품명이 비어 있습니다.');
  const media = manual ? (detail.localAttachments || []).some(f => (s.type === 'ALBUM' ? /\.(?:wav|mp3|flac|aiff?|m4a|aac|ogg)$/i : /\.(?:mp4|mov|m4v|avi|mkv|wmv|mpeg|mpg|mxf)$/i).test(f.name || '')) : (effective.assets || effective.files || []).some(f => f.kind === (s.type === 'ALBUM' ? 'AUDIO' : 'VIDEO'));
  if (!media) warnings.push(manual ? `${s.type === 'ALBUM' ? '음원' : '영상'} 수신 파일이 아직 연결되지 않았습니다. 별도로 받은 원본을 연결하세요.` : s.type === 'ALBUM' ? '서비스에 업로드된 음원이 없습니다. 이메일·로컬 수신 파일을 확인하세요.' : '서비스에 업로드된 영상이 없습니다. 이메일·로컬 수신 파일을 확인하세요.');
  if (s.type === 'ALBUM') {
    if (!effective.tracks.length) warnings.push('트랙 정보가 없습니다.');
    for (const t of effective.tracks) {
      if (!t.lyrics && !t.is_instrumental && !t.instrumental_confirmed) warnings.push(`${t.track_no || '?'}번 ${t.track_title || '곡명 미입력'}: 가사 확인 필요`);
    }
  } else if (!(typeof s.mv_lyrics === 'string' ? s.mv_lyrics : s.original_lyrics)) warnings.push('뮤직비디오 가사가 없습니다.');
  return [...new Set(warnings)];
}
const submissionFields = new Set(['lyrics_with_translation', 'applicant_name', 'applicant_email', 'applicant_phone', 'title', 'artist_name', 'artist_name_en', 'release_date', 'genre', 'production_company', 'distributor', 'distributor_name', 'production_date', 'artist_type', 'album_type', 'members', 'previous_release', 'mv_song_title', 'mv_song_title_kr', 'mv_song_title_en', 'mv_song_title_official', 'mv_lyrics', 'original_lyrics', 'korean_lyrics_translation', 'mv_runtime', 'mv_format', 'mv_director', 'mv_lead_actor', 'mv_storyline', 'mv_production_company', 'mv_agency', 'mv_album_title', 'mv_production_date', 'mv_distribution_company', 'mv_business_reg_no', 'mv_usage', 'mv_desired_rating', 'mv_memo', 'mv_composer', 'mv_lyricist', 'mv_arranger']);
const trackFields = new Set(['original_lyrics', 'lyrics_with_translation', 'track_no', 'track_title', 'track_title_kr', 'track_title_en', 'track_title_official', 'performer', 'featuring', 'composer', 'lyricist', 'arranger', 'lyrics', 'translated_lyrics', 'notes', 'is_title', 'is_instrumental', 'instrumental_confirmed']);
function cleanFields(input, fields) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('수정 데이터 형식이 올바르지 않습니다.');
  const out = {};
  for (const [key, value] of Object.entries(input)) {
    if (!fields.has(key)) continue;
    if (['is_title', 'is_instrumental', 'instrumental_confirmed'].includes(key)) { if (typeof value !== 'boolean') throw new Error('곡 표시 형식이 올바르지 않습니다.'); out[key] = value; }
    else if (key === 'track_no') { if (!Number.isInteger(value) || value < 1 || value > 999) throw new Error('트랙번호를 확인하세요.'); out[key] = value; }
    else { if (typeof value !== 'string' || value.length > 150000) throw new Error('입력 내용이 너무 길거나 형식이 다릅니다.'); out[key] = value; }
  }
  return out;
}
export function validateLocalPatch(patch, current = {}, trackIds = []) {
  const result = { ...current };
  if ('reviewAcknowledgedRevision' in patch) {
    if (typeof patch.reviewAcknowledgedRevision !== 'string' || !/^(?:[a-f\d]{64})?$/.test(patch.reviewAcknowledgedRevision)) throw new Error('검토 기록을 다시 확인해 주세요.');
    result.reviewAcknowledgedRevision = patch.reviewAcknowledgedRevision;
  }
  if ('stage' in patch) { if (!STAGES.includes(patch.stage)) throw new Error('진행 단계를 확인하세요.'); result.stage = patch.stage; }
  if ('notes' in patch) { if (typeof patch.notes !== 'string' || patch.notes.length > 50000) throw new Error('메모는 50,000자까지 입력하세요.'); result.notes = patch.notes; }
  if ('dueDate' in patch) { if (typeof patch.dueDate !== 'string' || !/^(?:\d{4}-\d{2}-\d{2})?$/.test(patch.dueDate)) throw new Error('마감일을 확인하세요.'); result.dueDate = patch.dueDate; }
  if ('checklist' in patch) {
    if (!patch.checklist || Array.isArray(patch.checklist) || typeof patch.checklist !== 'object') throw new Error('체크리스트 형식을 확인하세요.');
    result.checklist = { ...current.checklist };
    for (const [key, value] of Object.entries(patch.checklist)) {
      if (!/^[\w가-힣:.-]{1,100}$/u.test(key) || typeof value !== 'boolean') throw new Error('체크리스트 값을 확인하세요.');
      result.checklist[key] = value;
    }
  }
  if ('overrides' in patch) {
    if (!patch.overrides || typeof patch.overrides !== 'object') throw new Error('수정 내용이 올바르지 않습니다.');
    const old = current.overrides || {};
    result.overrides = { ...old };
    if (patch.overrides.submission) {
      result.overrides.submission = { ...old.submission, ...cleanFields(patch.overrides.submission, submissionFields) };
      if ('mv_lyrics' in patch.overrides.submission && !('lyrics_with_translation' in patch.overrides.submission)) result.overrides.submission.lyrics_with_translation = '';
      if ('wbs_track_numbers' in patch.overrides.submission) {
        const selected = patch.overrides.submission.wbs_track_numbers;
        if (!Array.isArray(selected) || selected.length > 3 || new Set(selected).size !== selected.length || selected.some(n => !Number.isInteger(n) || n < 1 || n > 999)) throw new Error('WBS 신청곡은 서로 다른 트랙을 최대 3곡 지정하세요.');
        result.overrides.submission.wbs_track_numbers = selected;
      }
    }
    if (patch.overrides.tracks) {
      if (!Array.isArray(patch.overrides.tracks) || patch.overrides.tracks.length > 999) throw new Error('트랙 수정 내용을 확인하세요.');
      const merged = new Map((old.tracks || []).map(t => [t.id, t]));
      for (const t of patch.overrides.tracks) {
        const localId = /^local-[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(t.id);
        if (!trackIds.includes(t.id) && !localId) throw new Error('신청 트랙 또는 새 로컬 트랙만 수정할 수 있습니다.');
        if ('_deleted' in t && (!localId || typeof t._deleted !== 'boolean')) throw new Error('로컬에서 추가한 트랙만 삭제할 수 있습니다.');
        merged.set(t.id, { ...merged.get(t.id), id: t.id, ...cleanFields(t, trackFields), ...(localId ? { _deleted: t._deleted === true } : {}) });
        if ('lyrics' in t && !('lyrics_with_translation' in t)) merged.get(t.id).lyrics_with_translation = '';
      }
      result.overrides.tracks = [...merged.values()];
    }
  }
  result.updatedAt = now();
  return result;
}
export function validateSettings(patch, settings) {
  const result = { ...settings };
  for (const key of ['managerName', 'managerPhone', 'managerEmail', 'companyName']) if (key in patch) {
    if (typeof patch[key] !== 'string' || patch[key].length > 300) throw new Error('담당자 설정 값을 확인하세요.');
    result[key] = patch[key].trim();
  }
  for (const key of ['autoSync', 'autoGenerate']) if (key in patch) {
    if (typeof patch[key] !== 'boolean') throw new Error('자동화 설정 값을 확인하세요.');
    result[key] = patch[key];
  }
  return result;
}
export class Store {
  constructor(root) { this.root = root; this.file = path.join(root, 'state.json'); this.pending = Promise.resolve(); }
  async init() {
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
    try { this.data = JSON.parse(await fs.readFile(this.file, 'utf8')); }
    catch (error) {
      if (error.code !== 'ENOENT') throw new Error('로컬 관리 데이터가 손상되었습니다. 백업으로 복원하기 전에는 덮어쓰지 않습니다.');
      this.data = { version: 1, settings: { ...DEFAULT_SETTINGS }, cases: {}, jobs: [], lastSync: null, syncError: null };
    }
    if (this.data.version !== 1 || !this.data.cases || !Array.isArray(this.data.jobs)) throw new Error('지원하지 않는 로컬 관리 데이터입니다.');
    this.data.purgedCases ||= {};
    if (typeof this.data.purgedCases !== 'object' || Array.isArray(this.data.purgedCases)) throw new Error('휴지통 삭제 기록을 확인할 수 없습니다. 백업을 확인하세요.');
    this.data.settings = { ...DEFAULT_SETTINGS, ...this.data.settings };
    for (const job of this.data.jobs) if (['running', 'queued'].includes(job.status)) Object.assign(job, { status: 'failed', message: '앱 종료로 중단되었습니다. 다시 실행하세요.', finishedAt: now() });
    await this.save();
    return this;
  }
  save() {
    const snapshot = JSON.parse(JSON.stringify(this.data));
    this.pending = this.pending.catch(() => {}).then(() => atomicJSON(this.file, snapshot));
    return this.pending;
  }
  audit(id, action, message) {
    const item = this.data.cases[id];
    item.history = [{ at: now(), action, message }, ...(item.history || [])].slice(0, 300);
  }
}
