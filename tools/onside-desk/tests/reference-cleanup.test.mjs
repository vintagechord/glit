import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanLyricRecord, isLabelHint, stripReferenceBoilerplate } from '../reference-cleanup.mjs';

test('applicant guidance and page footers are removed, ordinary lyrics are kept', () => {
  const guidance = '작성하신 신청서를  HYPERLINK "mailto:onside17@daum.net" onside17@daum.net으로 보내주시면 해당 내용으로 심의가 진행됩니다. 기타 문의사항은 이메일 또는 010-8436-9035로 연락주세요.';
  assert.equal(stripReferenceBoilerplate(`가사 끝\n\n\n${guidance}\n\n\n페이지　 /\n\n`), '가사 끝');
  assert.equal(stripReferenceBoilerplate('아~아~나는 좋아(코러스)\n페이지 2 / 3\n- 3 -'), '아~아~나는 좋아(코러스)');
  const lyrics = '너의 페이지를 넘겨\n메일을 보내줘\n(번역: 안녕)';
  assert.equal(stripReferenceBoilerplate(lyrics), lyrics);
  const record = { lyrics: `가사\n페이지 /`, title: '페이지 /' };
  assert.deepEqual(cleanLyricRecord(record), { lyrics: '가사', title: '페이지 /' });
  assert.equal(cleanLyricRecord({ lyrics: '그대로' }).lyrics, '그대로');
});

test('only qualifier-like parentheses are label hints', () => {
  for (const value of ['(한글 및 영문)', '(없을시 미기입)', '（국적）', '(선택)']) assert.equal(isLabelHint(value), true, value);
  for (const value of ['(코러스)', '(fluffy fluffy)', '(번역: 안녕)', '한글 및 영문']) assert.equal(isLabelHint(value), false, value);
});
