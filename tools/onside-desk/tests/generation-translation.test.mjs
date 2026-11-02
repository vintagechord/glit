import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createDesk } from '../server.mjs';

const id = '11111111-1111-4111-8111-111111111111';
const trackId = '22222222-2222-4222-8222-222222222222';

async function onlineDesk(t, { translator, lyrics = 'Where we go\nLook at the road' } = {}) {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'onside-generation-translation-'));
  const submission = { id, type: 'ALBUM', title: '온라인 앨범', artist_name: '가수', payment_status: 'PAID', status: 'PRE_REVIEW', updated_at: '2026-11-02T00:00:00Z' };
  const source = {
    sourceStatus: () => ({ configured: true, downloadsConfigured: true }),
    fetchSubmissions: async () => [{ ...submission }],
    fetchSubmission: async () => ({ submission: { ...submission }, tracks: [{ id: trackId, track_no: 1, track_title: '첫 곡', lyrics }], files: [], assets: [], stations: [], stationReviews: [] }),
    downloadAsset: async () => { throw Error('no downloads'); },
  };
  const generated = [];
  const generator = async ({ tracks }) => { generated.push(tracks.map(track => track.lyrics)); return { artifacts: [], warnings: [] }; };
  const desk = await createDesk({ dataRoot, port: 0, source, generator, translator, openFolder: () => {}, timers: false });
  t.after(async () => { await desk.close(); await fs.rm(dataRoot, { recursive: true, force: true }); });
  await desk.sync();
  return { desk, generated };
}

test('generation translates untranslated online lyrics first and keeps only the lyric edit', async t => {
  const calls = [];
  const translator = async input => {
    calls.push(input.allowOnline);
    return { overrides: { tracks: [{ id: trackId, lyrics: `${input.detail.tracks[0].lyrics}\n(번역: 어디로 가든. 길을 바라봐.)` }] }, translatedCount: 2, warnings: ['번역 확인'] };
  };
  const { desk, generated } = await onlineDesk(t, { translator });
  desk.enqueue(id, 'generate'); await desk.idle();
  assert.deepEqual(calls, [true]);
  assert.deepEqual(generated, [['Where we go\nLook at the road\n(번역: 어디로 가든. 길을 바라봐.)']]);
  assert.deepEqual(desk.store.data.cases[id].local.overrides.tracks, [{ id: trackId, lyrics: 'Where we go\nLook at the road\n(번역: 어디로 가든. 길을 바라봐.)', lyrics_with_translation: '' }]);
  assert.ok(desk.store.data.cases[id].generations[0].warnings.includes('번역 확인'));
  // The translated text no longer needs translating, so the next generation calls nothing.
  desk.enqueue(id, 'generate'); await desk.idle();
  assert.equal(calls.length, 1);
});

test('Korean-only lyrics skip translation and a failed translation still generates with a warning', async t => {
  let calls = 0;
  const korean = await onlineDesk(t, { lyrics: '한국어 가사만 있습니다', translator: async () => { calls++; throw Error('unexpected'); } });
  korean.desk.enqueue(id, 'generate'); await korean.desk.idle();
  assert.equal(calls, 0); assert.equal(korean.generated.length, 1);
  const failing = await onlineDesk(t, { translator: async () => { throw Object.assign(new Error('번역 서비스에 연결하지 못했습니다.'), {}); } });
  failing.desk.enqueue(id, 'generate'); await failing.desk.idle();
  assert.deepEqual(failing.generated, [['Where we go\nLook at the road']]);
  assert.ok(failing.desk.store.data.cases[id].generations[0].warnings.some(warning => /자동 번역하지 못했습니다/.test(warning)));
});

test('stored manual cases lose reference guidance and qualifier values once, keeping typed edits', async t => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'onside-reference-upgrade-'));
  t.after(() => fs.rm(dataRoot, { recursive: true, force: true }));
  const caseId = 'manual-33333333-3333-4333-8333-333333333333';
  const reference = path.join(dataRoot, '신청별 자료', caseId, '기준파일');
  await fs.mkdir(reference, { recursive: true }); await fs.writeFile(path.join(reference, '요청서.docx'), 'fixture');
  const guidance = '작성하신 신청서를  HYPERLINK "mailto:onside17@daum.net" onside17@daum.net으로 보내주시면 해당 내용으로 심의가 진행됩니다.';
  const submission = { id: caseId, type: 'MV_DISTRIBUTION', title: '말랑말랑 해', artist_name: '(한글 및 영문)', mv_lyrics: `말랑말랑해\n\n${guidance}\n\n페이지  /`, created_at: '2026-11-02T00:00:00Z', updated_at: '2026-11-02T00:00:00Z' };
  const item = { source: 'manual', submission, detail: { source: 'manual', submission, tracks: [], stations: [], stationReviews: [], files: [], assets: [] },
    importInfo: { parserVersion: 4, filename: '요청서.docx', extractedText: '원문', warnings: [] },
    local: { stage: 'RECEIVED', notes: '', dueDate: '', checklist: {}, overrides: { submission: { title: '직접 고친 제목' } } }, generations: [{ id: 'old' }], attachments: [], history: [] };
  await fs.writeFile(path.join(dataRoot, 'state.json'), JSON.stringify({ version: 1, cases: { [caseId]: item }, jobs: [], settings: {}, purgedCases: {}, lastSync: null, syncError: null }));
  const importer = async () => ({ submission: { artist_name: 'jihajoochajang' }, tracks: [], extractedText: '원문', warnings: [] });
  const source = { sourceStatus: () => ({ configured: false }), fetchSubmissions: async () => [], fetchSubmission: async () => { throw Error('offline'); } };
  const desk = await createDesk({ dataRoot, port: 0, source, importer, reviewer: async () => ({ sourceHash: 'x', findings: [] }), openFolder: () => {}, timers: false });
  t.after(() => desk.close());
  const repaired = desk.store.data.cases[caseId];
  assert.equal(repaired.detail.submission.artist_name, 'jihajoochajang');
  assert.equal(repaired.detail.submission.mv_lyrics, '말랑말랑해');
  assert.equal(repaired.local.overrides.submission.title, '직접 고친 제목');
  assert.equal(repaired.importInfo.parserVersion, 5); assert.equal(repaired.sourceChanged, true);
  assert.match(repaired.history[0].message, /안내문·쪽 번호/);
});
