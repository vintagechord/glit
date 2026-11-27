// 음원 가사 대조 작업: 신청과 별개로, 넣은 음원을 가사와 대조하거나 가사지 초안을 만든다. 순수 함수만 둔다.
import { randomUUID } from 'node:crypto';
import { AUDIO_EXTENSIONS, autoMapping } from './audio-check.mjs';

export const SESSION_LIMITS = { title: 200, artist: 200, genre: 100, trackTitle: 300, lyrics: 150000, tracks: 60 };
export const SESSION_LANGUAGES = ['lyrics', 'auto'];

const extOf = (name) => (/\.([^.\\/]+)$/.exec(String(name ?? ''))?.[1] ?? '').toLowerCase();
export const isAudioName = (name) => AUDIO_EXTENSIONS.has(extOf(name));

/** 파일 이름 → 트랙 번호·곡명. "01_꽃 노래.wav" → 1, "꽃 노래". 번호가 없으면 fallbackNo. */
export function trackFromFileName(name, fallbackNo) {
  const base = String(name ?? '').normalize('NFC').replace(/\.[^.\\/]+$/, '').trim();
  const m = /^0?(\d{1,2})(?:[ ._\-)]+|$)(.*)$/.exec(base);
  const title = (m ? m[2] : base).replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  return { track_no: m ? Number(m[1]) : fallbackNo, track_title: title || base || `${fallbackNo}번 곡` };
}

export function newSessionTrack(fields = {}) {
  return {
    id: randomUUID(),
    track_no: Number.isInteger(fields.track_no) && fields.track_no > 0 ? fields.track_no : 1,
    track_title: String(fields.track_title ?? '').slice(0, SESSION_LIMITS.trackTitle),
    lyrics: String(fields.lyrics ?? '').slice(0, SESSION_LIMITS.lyrics),
    is_instrumental: fields.is_instrumental === true,
  };
}

/**
 * 새로 넣은 음원의 자리: 음원이 아직 없는 트랙 중 번호·곡명이 맞는 트랙, 없으면 새 트랙.
 * 반환: { tracks, mapping } (원본을 바꾸지 않는다).
 */
export function placeAudioFile(tracks, mapping, attachment) {
  const open = tracks.filter((t) => !mapping[t.id]);
  const owner = open.length ? Object.entries(autoMapping(open, [attachment]).mapping).find(([, id]) => id === attachment.id)?.[0] : null;
  if (owner) return { tracks, mapping: { ...mapping, [owner]: attachment.id } };
  if (tracks.length >= SESSION_LIMITS.tracks) throw new Error(`한 작업에는 ${SESSION_LIMITS.tracks}곡까지 넣을 수 있습니다.`);
  const used = new Set(tracks.map((t) => Number(t.track_no)));
  let next = tracks.length + 1;
  while (used.has(next)) next += 1;
  const named = trackFromFileName(attachment.name, next);
  const track = newSessionTrack({ ...named, track_no: used.has(named.track_no) ? next : named.track_no });
  return { tracks: [...tracks, track], mapping: { ...mapping, [track.id]: attachment.id } };
}

const str = (value, max, label) => {
  if (typeof value !== 'string' || value.length > max) throw new Error(`${label}을(를) 확인하세요.`);
  return value;
};

/** 작업 정보·트랙 수정. 모르는 트랙이나 형식이 틀린 값은 거절하고, 보내지 않은 값은 그대로 둔다. */
export function patchSession(session, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('수정 내용을 확인하세요.');
  const next = { ...session };
  if ('title' in patch) next.title = str(patch.title, SESSION_LIMITS.title, '작업 이름').trim();
  if ('artist' in patch) next.artist = str(patch.artist, SESSION_LIMITS.artist, '아티스트').trim();
  if ('genre' in patch) next.genre = str(patch.genre, SESSION_LIMITS.genre, '장르').trim();
  if ('language' in patch) {
    if (!SESSION_LANGUAGES.includes(patch.language)) throw new Error('받아쓰기 언어를 확인하세요.');
    next.language = patch.language;
  }
  if ('tracks' in patch) {
    if (!Array.isArray(patch.tracks)) throw new Error('트랙 정보를 확인하세요.');
    const byId = new Map(session.tracks.map((t) => [t.id, t]));
    const changes = new Map();
    for (const item of patch.tracks) {
      if (!item || typeof item.id !== 'string' || !byId.has(item.id) || changes.has(item.id)) throw new Error('트랙 정보를 확인하세요.');
      const change = {};
      if ('track_title' in item) change.track_title = str(item.track_title, SESSION_LIMITS.trackTitle, '곡명');
      if ('lyrics' in item) change.lyrics = str(item.lyrics, SESSION_LIMITS.lyrics, '가사').replace(/\r\n?/g, '\n');
      if ('track_no' in item) {
        if (!Number.isInteger(item.track_no) || item.track_no < 1 || item.track_no > 999) throw new Error('트랙 번호를 확인하세요.');
        change.track_no = item.track_no;
      }
      if ('is_instrumental' in item) {
        if (typeof item.is_instrumental !== 'boolean') throw new Error('연주곡 표시를 확인하세요.');
        change.is_instrumental = item.is_instrumental;
      }
      changes.set(item.id, change);
    }
    next.tracks = session.tracks.map((t) => (changes.has(t.id) ? { ...t, ...changes.get(t.id) } : t));
  }
  return next;
}

/** 신청 건의 트랙(가사 포함)과 이 Mac에 있는 음원으로 새 작업의 트랙·연결을 만든다. */
export function tracksFromCase(caseTracks, attachments) {
  const tracks = (Array.isArray(caseTracks) ? caseTracks : []).slice(0, SESSION_LIMITS.tracks).map((t, i) => newSessionTrack({
    track_no: Number(t.track_no) || i + 1,
    track_title: String(t.track_title || t.track_title_official || t.track_title_kr || t.title || '').trim(),
    lyrics: typeof t.lyrics === 'string' ? t.lyrics : '',
    is_instrumental: t.is_instrumental === true,
  }));
  const auto = autoMapping(tracks, attachments);
  return { tracks, mapping: auto.mapping };
}

/** 가사지 텍스트(곡마다 제목과 가사, 곡 사이 빈 줄 두 개). */
export function lyricSheetText(session) {
  const head = [session.artist, session.title].filter(Boolean).join(' - ') + (session.genre ? `  (장르 : ${session.genre})` : '');
  const body = [...session.tracks]
    .sort((a, b) => (Number(a.track_no) || 0) - (Number(b.track_no) || 0))
    .map((t) => `${String(t.track_no).padStart(2, '0')}. ${t.track_title}\n\n${t.is_instrumental && !t.lyrics.trim() ? '가사 없음 / Instrumental' : t.lyrics.trim() || '가사 입력 필요'}`)
    .join('\n\n\n');
  return `${head ? `${head}\n\n\n` : ''}${body}\n`;
}
