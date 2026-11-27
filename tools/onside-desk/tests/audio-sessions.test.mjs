import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import PizZip from 'pizzip';
import {createDesk} from '../server.mjs';
import {lyricsHash} from '../audio-check.mjs';
import {isAudioName, lyricSheetText, newSessionTrack, patchSession, placeAudioFile, trackFromFileName, tracksFromCase} from '../audio-sessions.mjs';

// Made-up lyrics only (no commercial songs in the repository).
const FIRST = '하늘 위로 걸어가\n구름 사이 노래해';
const SECOND = '작은 별이 반짝여\n밤하늘을 건너가';
const waitFor = async (check, timeout = 2000) => {
  const until = Date.now() + timeout;
  while (!check()) { if (Date.now() > until) throw new Error('timed out'); await new Promise(resolve => setTimeout(resolve, 5)); }
};

test('file names become track numbers and titles', () => {
  assert.deepEqual(trackFromFileName('01_꽃 노래.wav', 9), {track_no: 1, track_title: '꽃 노래'});
  assert.deepEqual(trackFromFileName('07 똑똑 노래.mp3', 9), {track_no: 7, track_title: '똑똑 노래'});
  assert.deepEqual(trackFromFileName('10_꽃 노래 (MR).wav', 9), {track_no: 10, track_title: '꽃 노래 (MR)'});
  assert.deepEqual(trackFromFileName('별빛_노래.flac', 3), {track_no: 3, track_title: '별빛 노래'});
  assert.deepEqual(trackFromFileName('02.wav', 3), {track_no: 2, track_title: '02'});
  assert.equal(isAudioName('a.WAV'), true);
  assert.equal(isAudioName('a.pdf'), false);
});

test('a new audio file fills the open track it matches, otherwise becomes a new track', () => {
  const one = newSessionTrack({track_no: 1, track_title: '첫 곡', lyrics: FIRST});
  const two = newSessionTrack({track_no: 2, track_title: '둘째 곡', lyrics: SECOND});
  let placed = placeAudioFile([one, two], {[one.id]: null, [two.id]: null}, {id: 'a2', name: '02 둘째 곡.wav'});
  assert.deepEqual(placed.mapping, {[one.id]: null, [two.id]: 'a2'});
  assert.equal(placed.tracks.length, 2);
  placed = placeAudioFile(placed.tracks, placed.mapping, {id: 'a1', name: '첫 곡 마스터.wav'});
  assert.equal(placed.mapping[one.id], 'a1');
  placed = placeAudioFile(placed.tracks, placed.mapping, {id: 'a3', name: '02 둘째 곡.mp3'});
  assert.equal(placed.tracks.length, 3);
  assert.equal(placed.tracks[2].track_no, 3, 'a number already in use moves to the next free one');
  assert.equal(placed.tracks[2].track_title, '둘째 곡');
  assert.equal(placed.mapping[placed.tracks[2].id], 'a3');
});

test('patchSession validates every field and keeps what was not sent', () => {
  const track = newSessionTrack({track_no: 1, track_title: '첫 곡'});
  const session = {id: 's', title: '작업', artist: '', genre: '', language: 'lyrics', tracks: [track]};
  const next = patchSession(session, {title: ' 새 이름 ', language: 'auto', tracks: [{id: track.id, lyrics: '가\r\n나', is_instrumental: true}]});
  assert.equal(next.title, '새 이름');
  assert.equal(next.language, 'auto');
  assert.deepEqual(next.tracks[0], {...track, lyrics: '가\n나', is_instrumental: true});
  assert.equal(session.tracks[0].lyrics, '', 'the original is untouched');
  for (const bad of [{language: 'en'}, {title: 5}, {tracks: [{id: 'missing'}]}, {tracks: [{id: track.id}, {id: track.id}]}, {tracks: [{id: track.id, track_no: 0}]}, {tracks: [{id: track.id, is_instrumental: 'yes'}]}, null, []]) {
    assert.throws(() => patchSession(session, bad), Error, JSON.stringify(bad));
  }
});

test('a case becomes tracks with lyrics and its audio files mapped by number or title', () => {
  const {tracks, mapping} = tracksFromCase([{track_no: 1, track_title: '첫 곡', lyrics: FIRST}, {track_no: 2, track_title: '둘째 곡', lyrics: SECOND, is_instrumental: false}], [{id: 'x', name: '둘째 곡.wav'}, {id: 'y', name: '01-첫 곡.mp3'}]);
  assert.deepEqual(tracks.map(t => [t.track_no, t.track_title, t.lyrics]), [[1, '첫 곡', FIRST], [2, '둘째 곡', SECOND]]);
  assert.deepEqual(Object.values(mapping), ['y', 'x']);
});

test('lyricSheetText lists tracks in order with the given heading only', () => {
  const tracks = [newSessionTrack({track_no: 2, track_title: '둘째 곡', lyrics: SECOND}), newSessionTrack({track_no: 1, track_title: '첫 곡', lyrics: ''}), newSessionTrack({track_no: 3, track_title: '연주', is_instrumental: true})];
  const text = lyricSheetText({title: '모음', artist: '', genre: '', tracks});
  assert.equal(text, `모음\n\n\n01. 첫 곡\n\n가사 입력 필요\n\n\n02. 둘째 곡\n\n${SECOND}\n\n\n03. 연주\n\n가사 없음 / Instrumental\n`);
  assert.match(lyricSheetText({title: '모음', artist: '가수', genre: '발라드', tracks: []}), /^가수 - 모음 {2}\(장르 : 발라드\)/);
});

function sheetRun({tracks, mapping}) {
  return {id: randomUUID(), status: 'completed', createdAt: '2026-11-27T00:00:00.000Z', finishedAt: '2026-11-27T00:01:00.000Z', engineVersion: 'audio-check-1',
    tracks: tracks.map(t => {
      if (!mapping[t.id]) return {trackId: t.id, attachmentId: null, lyricsHash: lyricsHash(t.lyrics ?? ''), separation: null, duration: null, foreign: false, status: 'skipped', suggestions: [], applied: []};
      const suggestions = t.lyrics
        ? [{id: `${t.id}:replace:0:x`, trackId: t.id, kind: 'replace', confidence: 'high', start: 1, end: 3, op: {type: 'replaceLine', lines: [0], from: t.lyrics.split('\n')[0], to: '고쳐 부른 줄'}, hint: '', score: 9, lines: [0]}]
        : [{id: `${t.id}:generated::y`, trackId: t.id, kind: 'generated', confidence: 'check', start: 1, end: 9, op: {type: 'insertLines', afterLine: -1, lines: ['들린 첫 줄', '', '들린 둘째 줄']}, hint: '', score: null, lines: [], times: [[1, 3], null, [7, 9]]}];
      return {trackId: t.id, attachmentId: mapping[t.id], lyricsHash: lyricsHash(t.lyrics ?? ''), separation: 'demucs', duration: 180, foreign: false, status: 'ok', suggestions, applied: []};
    })};
}

async function setup(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'onside-audio-session-'));
  const calls = {runs: [], workers: []};
  const source = {sourceStatus: () => ({configured: false}), fetchSubmissions: async () => [], fetchSubmission: async () => { throw Error('온라인 조회 금지'); }, downloadAsset: async () => { throw Error('다운로드 금지'); }};
  const remote = {configured: () => false, ...Object.fromEntries(['getResults', 'getEmailPreview', 'saveResults', 'uploadCertificate', 'downloadAsset', 'saveAlbumInfo'].map(key => [key, async () => { throw Error('원격 쓰기 금지'); }]))};
  const reviewer = async d => ({sourceHash: createHash('sha256').update(JSON.stringify(d.tracks.map(t => [t.id, t.lyrics]))).digest('hex'), findings: [], requiresReview: false, counts: {total: 0}});
  const importer = async () => ({submission: {title: '수동 앨범', artist_name: '수동 가수', genre: '발라드'}, tracks: [{track_no: 1, track_title: '첫 곡', lyrics: FIRST}, {track_no: 2, track_title: '둘째 곡', lyrics: SECOND}], extractedText: '원문', warnings: [], format: 'DOCX'});
  const generator = async () => ({artifacts: [], warnings: []});
  const translator = async () => ({overrides: {}, translatedCount: 0, warnings: []});
  const audio = {
    engineStatus: async () => ({installed: options.installed ?? true, version: 'audio-check-1', uv: '/fake/uv', needsUpdate: false}),
    installEngine: async () => ({version: 'audio-check-1'}),
    startWorker: input => { const worker = {input, async request() { return {}; }, async close() { worker.closed = true; }}; calls.workers.push(worker); return worker; },
    runAudioCheck: async input => { calls.runs.push(input); if (options.hold) await options.hold; return sheetRun(input); },
  };
  const desk = await createDesk({dataRoot: root, port: 0, source, remote, importer, reviewer, generator, translator, audio, openFolder: () => {}, timers: false});
  const url = `http://127.0.0.1:${desk.server.address().port}`;
  const api = (route, init = {}) => fetch(url + route, {...init, headers: {'X-Desk-Token': desk.token, 'Content-Type': 'application/json', ...init.headers}});
  const json = async (route, method, body) => { const response = await api(route, {method, body: body === undefined ? undefined : JSON.stringify(body)}); return {status: response.status, body: await response.json()}; };
  const upload = async (id, name, body = 'RIFF fixture audio') => { const response = await api(`/api/audio-sessions/${id}/files?filename=${encodeURIComponent(name)}`, {method: 'POST', body}); return {status: response.status, body: await response.json()}; };
  t.after(async () => { await desk.close(); await fs.rm(root, {recursive: true, force: true}); });
  return {desk, root, url, api, json, upload, calls};
}

test('a session takes dropped audio files as tracks and lists in the state', async t => {
  const s = await setup(t);
  const created = await s.json('/api/audio-sessions', 'POST', {title: '고객 음원'});
  assert.equal(created.status, 201);
  const id = created.body.session.id;
  assert.equal(created.body.session.title, '고객 음원');
  assert.equal(created.body.session.language, 'lyrics');
  let result = await s.upload(id, '02 둘째 곡.wav');
  assert.equal(result.status, 200);
  result = await s.upload(id, '01_첫 곡.mp3');
  const session = result.body.session;
  assert.deepEqual(session.tracks.map(t => [t.track_no, t.track_title, t.lyrics]), [[2, '둘째 곡', ''], [1, '첫 곡', '']]);
  assert.deepEqual(Object.values(session.audioCheck.mapping), session.attachments.map(a => a.id));
  const stored = s.desk.store.data.audioSessions[id].attachments;
  for (const a of stored) assert.equal(await fs.readFile(path.join(s.root, '음원 가사 대조', id, '음원', a.storedName), 'utf8'), 'RIFF fixture audio');
  assert.equal((await s.upload(id, '안내.pdf')).status, 400);
  const [summary] = s.desk.publicState().audioSessions;
  assert.deepEqual([summary.id, summary.title, summary.tracks, summary.files, summary.suggestions], [id, '고객 음원', 2, 2, null]);
  assert.equal((await s.json('/api/audio-sessions/00000000-0000-4000-8000-000000000000', 'GET')).status, 404);
});

test('checking a session uses its own folder, the language choice, and applies a lyric sheet draft and a replace', async t => {
  const s = await setup(t);
  const id = (await s.json('/api/audio-sessions', 'POST', {})).body.session.id;
  assert.match(s.desk.store.data.audioSessions[id].title, /^음원 대조 \d{1,2}\/\d{1,2} \d{2}:\d{2}$/);
  await s.upload(id, '01 첫 곡.wav');
  let session = (await s.upload(id, '02 둘째 곡.wav')).body.session;
  const [one, two] = session.tracks;
  assert.equal((await s.json(`/api/audio-sessions/${id}`, 'PATCH', {language: 'fr'})).status, 400);
  session = (await s.json(`/api/audio-sessions/${id}`, 'PATCH', {artist: '가수', language: 'auto', tracks: [{id: two.id, lyrics: SECOND}]})).body.session;
  assert.equal(session.tracks[1].lyrics, SECOND);
  const started = await s.json(`/api/audio-sessions/${id}/check`, 'POST', {});
  assert.equal(started.status, 202);
  assert.equal(started.body.job.kind, 'audio-session');
  await s.desk.audioIdle();
  const [input] = s.calls.runs;
  assert.equal(input.caseDir, path.join(s.root, '음원 가사 대조', id));
  assert.equal(input.audioDir, path.join(s.root, '음원 가사 대조', id, '음원'));
  assert.ok(input.attachments.every(a => a.path.startsWith(input.audioDir + path.sep)));
  assert.deepEqual(input.tracks.map(t => t.language), ['auto', 'auto']);
  assert.equal(s.calls.workers[0].closed, true);
  const job = s.desk.store.data.jobs.find(j => j.kind === 'audio-session');
  assert.equal(job.status, 'completed');
  session = (await s.json(`/api/audio-sessions/${id}`, 'GET')).body.session;
  const run = session.audioCheck.latest;
  const sheet = run.tracks[0].suggestions[0], replace = run.tracks[1].suggestions[0];
  assert.equal(sheet.kind, 'generated');
  const applied = await s.json(`/api/audio-sessions/${id}/apply`, 'POST', {runId: run.id, items: [{suggestionId: sheet.id, text: '들린 첫 줄\n\n고친 둘째 줄'}, {suggestionId: replace.id}]});
  assert.equal(applied.status, 200);
  assert.equal(applied.body.applied, 2);
  assert.deepEqual(applied.body.session.tracks.map(t => t.lyrics), ['들린 첫 줄\n\n고친 둘째 줄', '고쳐 부른 줄\n밤하늘을 건너가']);
  assert.deepEqual(applied.body.session.audioCheck.staleTracks.sort(), [one.id, two.id].sort());
  assert.equal((await s.json(`/api/audio-sessions/${id}/apply`, 'POST', {runId: run.id, items: [{suggestionId: replace.id}]})).status, 409);
  assert.equal(s.desk.publicState().audioSessions[0].suggestions, 2);
});

test('a session exports its lyrics as a Word lyric sheet and as text, and streams audio with ranges', async t => {
  const s = await setup(t);
  const id = (await s.json('/api/audio-sessions', 'POST', {title: '모음'})).body.session.id;
  const session = (await s.upload(id, '01 첫 곡.wav', 'RIFF0123456789')).body.session;
  await s.json(`/api/audio-sessions/${id}`, 'PATCH', {artist: '가수', tracks: [{id: session.tracks[0].id, lyrics: FIRST}]});
  const docx = await s.api(`/api/audio-sessions/${id}/export?format=docx`);
  assert.equal(docx.status, 200);
  assert.match(decodeURIComponent(docx.headers.get('content-disposition')), /가사지_모음\.docx/);
  const xml = new PizZip(Buffer.from(await docx.arrayBuffer())).file('word/document.xml').asText().replace(/<[^>]+>/g, '');
  assert.match(xml, /가수 - 모음/);
  assert.match(xml, /하늘 위로 걸어가/);
  const txt = await s.api(`/api/audio-sessions/${id}/export?format=txt`);
  const text = Buffer.from(await txt.arrayBuffer()).toString('utf8');
  assert.match(text, /^﻿?가수 - 모음\r\n/);
  assert.match(text, /01\. 첫 곡\r\n\r\n하늘 위로 걸어가\r\n구름 사이 노래해/);
  assert.equal((await s.api(`/api/audio-sessions/${id}/export?format=pdf`)).status, 400);
  const attachmentId = session.attachments[0].id;
  const partial = await s.api(`/api/audio-sessions/${id}/files/${attachmentId}/stream`, {headers: {Range: 'bytes=4-7'}});
  assert.equal(partial.status, 206);
  assert.equal(await partial.text(), '0123');
});

test('a session from a case references the case audio and lyrics, and removing or deleting never touches the case files', async t => {
  const s = await setup(t);
  const imported = await s.api(`/api/manual/import?type=ALBUM&filename=${encodeURIComponent('신청서.docx')}`, {method: 'POST', body: 'fixture'});
  const {id: caseId} = await imported.json();
  for (const name of ['02 둘째 곡.wav', '01_첫 곡.wav', '안내.pdf']) {
    const response = await s.api(`/api/cases/${caseId}/attachments?filename=${encodeURIComponent(name)}`, {method: 'POST', body: `RIFF ${name}`});
    assert.equal(response.status, 200);
  }
  assert.equal(s.desk.publicState().cases.find(c => c.id === caseId).audioFiles, 2);
  const made = await s.json('/api/audio-sessions/from-case', 'POST', {caseId});
  assert.equal(made.status, 201);
  const session = made.body.session;
  assert.deepEqual([session.title, session.artist, session.genre], ['수동 앨범', '수동 가수', '발라드']);
  assert.deepEqual(session.source, {caseId, title: '수동 앨범', manual: true});
  assert.deepEqual(session.tracks.map(t => [t.track_no, t.track_title, t.lyrics]), [[1, '첫 곡', FIRST], [2, '둘째 곡', SECOND]]);
  assert.deepEqual(session.tracks.map(t => session.attachments.find(a => a.id === session.audioCheck.mapping[t.id])?.name), ['01_첫 곡.wav', '02 둘째 곡.wav']);
  assert.ok(session.attachments.every(a => a.fromCase));
  await s.json(`/api/audio-sessions/${session.id}/check`, 'POST', {});
  await s.desk.audioIdle();
  assert.ok(s.calls.runs[0].attachments.every(a => a.path.includes(`${path.sep}신청별 자료${path.sep}${caseId}${path.sep}이메일 파일${path.sep}`)));
  const caseFiles = () => fs.readdir(path.join(s.root, '신청별 자료', caseId, '이메일 파일'));
  const before = (await caseFiles()).length;
  const removed = await s.json(`/api/audio-sessions/${session.id}/tracks/${session.tracks[0].id}`, 'DELETE');
  assert.equal(removed.status, 200);
  assert.equal(removed.body.session.tracks.length, 1);
  assert.equal(removed.body.session.attachments.length, 1);
  assert.equal((await caseFiles()).length, before);
  assert.deepEqual((await s.json(`/api/audio-sessions/${session.id}`, 'DELETE')).body, {deleted: true});
  assert.equal((await caseFiles()).length, before);
  assert.equal(s.desk.store.data.audioSessions[session.id], undefined);
  assert.equal((await s.json('/api/audio-sessions/from-case', 'POST', {caseId: 'missing'})).status, 404);
});

test('a running session check blocks deleting and can be cancelled; the case check queue stays separate', async t => {
  let release;
  const s = await setup(t, {hold: new Promise(resolve => { release = resolve; })});
  const id = (await s.json('/api/audio-sessions', 'POST', {})).body.session.id;
  await s.upload(id, '01 첫 곡.wav');
  await s.json(`/api/audio-sessions/${id}/check`, 'POST', {});
  await waitFor(() => s.calls.runs.length === 1);
  assert.equal((await s.json(`/api/audio-sessions/${id}`, 'DELETE')).status, 409);
  const again = await s.json(`/api/audio-sessions/${id}/check`, 'POST', {});
  assert.equal(again.body.job.id, s.desk.store.data.jobs.find(j => j.kind === 'audio-session').id, 'one job per session');
  assert.deepEqual((await s.json(`/api/audio-sessions/${id}/cancel`, 'POST', {})).body, {cancelled: true});
  release();
  await s.desk.audioIdle();
  assert.equal(s.desk.store.data.jobs.find(j => j.kind === 'audio-session').status, 'cancelled');
  assert.equal((await s.json(`/api/audio-sessions/${id}`, 'DELETE')).status, 200);
  assert.deepEqual(await fs.readdir(path.join(s.root, '음원 가사 대조')), []);
});

test('a session check needs the engine and a mapped track', async t => {
  const s = await setup(t, {installed: false});
  const id = (await s.json('/api/audio-sessions', 'POST', {})).body.session.id;
  const result = await s.json(`/api/audio-sessions/${id}/check`, 'POST', {});
  assert.equal(result.status, 400);
  assert.match(result.body.error, /분석 도구를 먼저 설치/);
});
