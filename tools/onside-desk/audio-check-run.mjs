// 음원 ↔ 가사 대조 실행: 트랙마다 분석(캐시 또는 worker) → 정리 → 제안 → 점수·다시 받아쓰기 → 결과 저장.
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  THRESHOLDS,
  autoMapping,
  cleanTranscript,
  draftSuggestions,
  finalizeSuggestions,
  foreignRatio,
  lyricsHash,
  vocalPresence,
} from './audio-check.mjs';
import { ENGINE_VERSION } from './audio-engine.mjs';

const STAGE_LABELS = { decode: '음원 읽는 중', separate: '보컬 분리 중', transcribe: '받아쓰는 중', score: '점수 비교 중' };
// 분석 결과 형식. 바뀌면(level 추가) 예전 캐시는 쓰지 않고 다시 분석한다.
const ANALYSIS_FORMAT = 'level-1';
const ABORT_MESSAGE = '음원 대조를 중지했습니다.';
const MR_HINT = '원곡과 같은 음원일 수 있음';

export function progressStageLabel(stage) {
  return STAGE_LABELS[stage] ?? '분석 중';
}

function checkAbort(signal) {
  if (signal?.aborted) throw new Error(ABORT_MESSAGE);
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

export async function runAudioCheck({
  caseDir,
  tracks,
  attachments,
  mapping,
  worker,
  onProgress,
  signal,
  runId = randomUUID(),
  now = () => new Date().toISOString(),
} = {}) {
  const trackList = Array.isArray(tracks) ? tracks : [];
  const byAttachment = new Map((Array.isArray(attachments) ? attachments : []).map((a) => [a.id, a]));
  const attachmentOf = (track) => {
    const id = mapping?.[track.id];
    return id ? byAttachment.get(id) ?? null : null;
  };
  const mapped = trackList.filter((t) => attachmentOf(t));
  if (!mapped.length) throw new Error('연결된 음원이 없습니다.');

  const createdAt = now();
  const mappedIds = new Set(mapped.map((t) => t.id));
  const trackById = new Map(trackList.map((t) => [t.id, t]));
  // MR 트랙 → 원곡 트랙 (둘 다 연결된 짝만)
  const pairOf = new Map();
  for (const [mrId, vocalId] of Object.entries(autoMapping(trackList, attachments).mrPairs)) {
    if (mappedIds.has(mrId) && mappedIds.has(vocalId)) pairOf.set(mrId, vocalId);
  }
  const mrOfVocal = new Map([...pairOf].map(([mrId, vocalId]) => [vocalId, mrId]));
  const order = [...mapped.filter((t) => !pairOf.has(t.id)), ...mapped.filter((t) => pairOf.has(t.id))];
  const total = order.length;

  const filePath = (a) => path.join(caseDir, '이메일 파일', a.storedName);
  const label = (n, stage, track) =>
    `${n}/${total} ${stage} · ${String(track.track_no ?? '').padStart(2, '0')} ${track.track_title ?? ''}`;

  const analyze = async (attachment, mrAttachment, { transcribe, language }) => {
    checkAbort(signal);
    const parts = [attachment.sha256, ENGINE_VERSION, mrAttachment?.sha256 ?? '', language ?? 'auto', ANALYSIS_FORMAT];
    if (!transcribe) parts.push('no-transcribe');
    const key = createHash('sha256').update(parts.join('')).digest('hex').slice(0, 16);
    const outDir = path.join(caseDir, '음원 대조 캐시', key);
    const cacheFile = path.join(outDir, 'analysis.json');
    const cached = await readJson(cacheFile);
    if (cached) return cached;
    const payload = { file: filePath(attachment), outDir, transcribe, language };
    if (mrAttachment) payload.mr = filePath(mrAttachment);
    const result = await worker.request('analyze', payload);
    await fs.mkdir(outDir, { recursive: true });
    await fs.writeFile(cacheFile, JSON.stringify(result), 'utf8');
    return result;
  };

  // 바꿈 후보마다 강제 점수를 매기고, 같은 창을 가사 줄을 프롬프트로 다시 받아써 받아쓰기 착오를 가려낸다.
  // 다시 받아쓰기가 실패하거나 글을 돌려주지 않으면 그 요청은 null(확인 안 됨)로 남겨 강함이 되지 않게 한다.
  const score = async (analysis, draft, n, track) => {
    const scores = {};
    const redecodes = {};
    if (draft.scoreRequests.length) onProgress?.(label(n, '점수 비교 중', track));
    for (const req of draft.scoreRequests) {
      checkAbort(signal);
      const window = { vocals: analysis.vocals, start: req.start, end: req.end };
      const r = await worker.request('score', { ...window, candidates: req.candidates });
      scores[req.id] = r?.scores;
      checkAbort(signal);
      let text = null;
      try {
        const d = await worker.request('redecode', { ...window, prompt: req.candidates[0] });
        if (typeof d?.text === 'string') text = d.text;
      } catch {
        checkAbort(signal);
      }
      redecodes[req.id] = text;
    }
    return finalizeSuggestions(draft, scores, redecodes);
  };

  const detail = new Map(); // trackId -> { segments, energy } (result.json 전용)
  const entries = new Map();
  const pairResults = new Map(); // vocalTrackId -> { mrAnalysis, ratio, instrumental }

  const finish = (track, attachment, analysis, foreign, suggestions, segments, extra = {}) => {
    entries.set(track.id, {
      trackId: track.id,
      attachmentId: attachment.id,
      lyricsHash: lyricsHash(track.lyrics ?? ''),
      separation: analysis.separation ?? null,
      duration: analysis.duration ?? null,
      foreign,
      status: 'ok',
      suggestions,
      applied: [],
      ...extra,
    });
    detail.set(track.id, { segments, energy: analysis.energy ?? [] });
  };

  const instrumentalSuggestion = (track, duration) => ({
    id: `${track.id}:instrumental::mr-pair`,
    trackId: track.id,
    kind: 'instrumental',
    confidence: 'check',
    start: 0,
    end: duration ?? 0,
    op: null,
    hint: MR_HINT,
    score: null,
    lines: [],
  });

  const vocalTrack = async (track, attachment, n) => {
    const lyrics = track.lyrics ?? '';
    const foreign = foreignRatio(lyrics) > THRESHOLDS.foreignRatio;
    const language = foreign ? null : 'ko';
    const mrTrack = trackById.get(mrOfVocal.get(track.id));
    const mrAttachment = mrTrack ? attachmentOf(mrTrack) : null;
    onProgress?.(label(n, '보컬 분리 중', track));
    let analysis = await analyze(attachment, mrAttachment, { transcribe: true, language });
    if (mrTrack) {
      // 뺄셈 뒤 남은 보컬은 믹스 기준 level로 본다(level이 없으면 알 수 없으므로 같은 음원이라고 하지 않는다).
      const ratio = vocalPresence(analysis.level);
      const info = { separation: analysis.separation, ratio, duration: analysis.duration, instrumental: false };
      if (analysis.separation === 'mr' && ratio !== null && ratio < THRESHOLDS.noVocalRatio && lyrics.trim()) {
        info.instrumental = true;
        analysis = await analyze(attachment, null, { transcribe: true, language });
      }
      pairResults.set(track.id, info);
    }
    const segments = cleanTranscript(analysis.segments, analysis.energy);
    const draft = draftSuggestions({
      trackId: track.id, lyrics, segments, energy: analysis.energy, level: analysis.level, duration: analysis.duration, instrumental: false,
    });
    const suggestions = await score(analysis, draft, n, track);
    finish(track, attachment, analysis, foreign, suggestions, segments);
  };

  const instrumentalTrack = async (track, attachment, n) => {
    onProgress?.(label(n, '보컬 분리 중', track));
    const analysis = await analyze(attachment, null, { transcribe: false, language: null });
    const draft = draftSuggestions({
      trackId: track.id, lyrics: track.lyrics ?? '', segments: [], energy: analysis.energy, level: analysis.level,
      duration: analysis.duration, instrumental: true,
    });
    finish(track, attachment, analysis, false, draft.suggestions, []);
  };

  const mrTrack = async (track, attachment, n) => {
    const info = pairResults.get(pairOf.get(track.id));
    if (!info || info.separation !== 'mr') return instrumentalTrack(track, attachment, n);
    const suggestions = info.instrumental ? [instrumentalSuggestion(track, info.duration)] : [];
    entries.set(track.id, {
      trackId: track.id,
      attachmentId: attachment.id,
      lyricsHash: lyricsHash(track.lyrics ?? ''),
      separation: 'mr',
      duration: info.duration ?? null,
      foreign: false,
      status: 'ok',
      suggestions,
      applied: [],
    });
    detail.set(track.id, { segments: [], energy: [] });
  };

  let n = 0;
  for (const track of order) {
    checkAbort(signal);
    n += 1;
    const attachment = attachmentOf(track);
    try {
      if (pairOf.has(track.id)) await mrTrack(track, attachment, n);
      else if (track.is_instrumental) await instrumentalTrack(track, attachment, n);
      else await vocalTrack(track, attachment, n);
    } catch (error) {
      checkAbort(signal);
      entries.set(track.id, {
        trackId: track.id,
        attachmentId: attachment.id,
        lyricsHash: lyricsHash(track.lyrics ?? ''),
        separation: null,
        duration: null,
        foreign: false,
        status: 'failed',
        error: error?.message ?? String(error),
        suggestions: [],
        applied: [],
      });
    }
  }
  checkAbort(signal);

  const runTracks = trackList.map((track) => entries.get(track.id) ?? {
    trackId: track.id,
    attachmentId: null,
    lyricsHash: lyricsHash(track.lyrics ?? ''),
    separation: null,
    duration: null,
    foreign: false,
    status: 'skipped',
    suggestions: [],
    applied: [],
  });
  const analyzed = runTracks.filter((t) => t.status !== 'skipped');
  const run = {
    id: runId,
    status: analyzed.every((t) => t.status === 'failed') ? 'failed' : 'completed',
    createdAt,
    finishedAt: now(),
    engineVersion: ENGINE_VERSION,
    tracks: runTracks,
  };

  const dir = path.join(caseDir, '음원 대조', runId);
  await fs.mkdir(dir, { recursive: true });
  const full = {
    ...run,
    tracks: runTracks.map((t) => ({ ...t, transcript: detail.get(t.trackId)?.segments ?? [], energy: detail.get(t.trackId)?.energy ?? [] })),
  };
  await fs.writeFile(path.join(dir, 'result.json'), JSON.stringify(full), 'utf8');
  return run;
}
