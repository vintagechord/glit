import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relativePath: string) =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

test("normal album submissions save basic information before track entry", () => {
  const source = read("src/features/submissions/album-wizard.tsx");
  const basicStart = source.indexOf("const handleBasicInfoNext");
  const trackStart = source.indexOf("const handleTrackTemporarySave", basicStart);
  const basicHandler = source.slice(basicStart, trackStart);

  assert.match(
    source,
    /const standardSteps = \[[\s\S]*"작성 방식 선택",[\s\S]*"기본 정보",[\s\S]*"트랙 정보",[\s\S]*"접수 완료"/,
  );
  assert.match(source, /const compactSteps = \[[\s\S]*"작성 방식 선택",[\s\S]*"기본 정보",[\s\S]*"파일 업로드"/);
  assert.match(
    source,
    /const hasTrackStep =\s*!isOneClick && applicationFormMode === "online"/,
  );
  assert.match(basicHandler, /if \(!validateBasicInfoStep\(\)\)/);
  assert.match(basicHandler, /status: "DRAFT"/);
  assert.ok(
    basicHandler.indexOf('status: "DRAFT"') < basicHandler.indexOf("setStep(4)"),
    "the persisted draft must complete before the track step opens",
  );
  assert.match(
    basicHandler,
    /previousTracks\.map\(\(track\) =>[\s\S]*!track\.performer\.trim\(\)[\s\S]*performer: artistName\.trim\(\)/,
  );
});

test("track entry preserves compilation overrides and saves before upload", () => {
  const source = read("src/features/submissions/album-wizard.tsx");
  const tableEditor = read(
    "src/features/submissions/album-track-table-editor.tsx",
  );
  const trackStart = source.indexOf("const handleTrackInfoNext");
  const downloadedStart = source.indexOf(
    "const handleDownloadedApplicationContinue",
    trackStart,
  );
  const trackHandler = source.slice(trackStart, downloadedStart);

  assert.match(source, /performer: String\(row\.performer \?\? ""\)/);
  assert.match(source, /tracks\.some\(\(track\) => !track\.performer\.trim\(\)\)/);
  assert.match(source, /createAlbumTrackWithReusableCredits\(initialTrack, source\)/);
  assert.match(source, /applyAlbumTrackCreditsToBlankTracks\(prev, activeTrackIndex\)/);
  assert.match(source, /<AlbumTrackTableEditor/);
  assert.match(source, /onApplyCurrentCredits=\{applyCurrentCreditsToBlankTracks\}/);
  assert.match(source, /onPaste=\{applyPastedTracks\}/);
  assert.match(tableEditor, /같은 참여진으로 추가/);
  assert.match(tableEditor, /빈 트랙 추가/);
  assert.match(tableEditor, /빈 참여진 채우기/);
  assert.match(tableEditor, /여러 트랙 붙여넣기/);
  assert.match(tableEditor, /parseAlbumTrackTablePaste\(pasteText\)/);
  assert.match(
    source,
    /handleTrackTemporarySave\(\)[\s\S]*?>\s*임시 저장\s*<\/button>/,
  );
  assert.doesNotMatch(source, /기본 정보 수정/);
  assert.doesNotMatch(source, /트랙 임시 저장/);
  assert.doesNotMatch(source, /저장하고 트랙 정보 입력/);
  assert.match(source, /: "저장하고 다음 단계"/);
  assert.match(source, /: "다음 단계"\}\s*<\/button>/);
  assert.match(trackHandler, /validateTrackInfoStep\(\)/);
  assert.match(trackHandler, /validateTranslatedLyrics\(\)/);
  assert.match(trackHandler, /status: "PRE_REVIEW"/);
  assert.ok(
    trackHandler.indexOf('status: "PRE_REVIEW"') < trackHandler.indexOf("setStep(5)"),
    "tracks must be persisted before file upload opens",
  );
  assert.match(tableEditor, /aria-current=\{active \? "true" : undefined\}/);
  assert.match(tableEditor, /key=\{rowKeys\[index\] \?\? `track-row-\$\{index\}`\}/);
});

test("progress and English UI support dynamic five- to seven-step flows", () => {
  const progress = read("src/features/submissions/submission-progress.tsx");
  const translations = read(
    "src/components/i18n/english-language-pack.tsx",
  );

  assert.match(
    progress,
    /gridTemplateColumns: `repeat\(\$\{steps\.length\}, minmax\(0, 1fr\)\)`/,
  );
  assert.doesNotMatch(progress, /grid-cols-5/);

  for (const label of [
    "기본 정보",
    "작성 방식 선택",
    "트랙 정보",
    "가수명",
    "저장하고 다음 단계",
    "저장하고 파일 업로드",
    "같은 참여진으로 추가",
    "빈 트랙 추가",
    "빈 참여진 채우기",
    "여러 트랙 붙여넣기",
    "표에 적용",
    "최종 점검",
    "임시 저장",
    "다음 단계",
    "이전 단계",
  ]) {
    assert.match(translations, new RegExp(`"${label}":`));
  }
});
