import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relativePath: string) =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

test("album applications require one explicit form mode before form entry", () => {
  const source = read("src/features/submissions/album-wizard.tsx");
  const actions = read("src/features/submissions/actions.ts");
  const oneClickStart = source.indexOf("const oneClickSteps");
  const uploadStart = source.indexOf("const uploadFormSteps", oneClickStart);
  const oneClickSteps = source.slice(oneClickStart, uploadStart);

  assert.match(
    source,
    /React\.useState<ApplicationFormMode \| null>\(null\)/,
  );
  assert.match(source, /\{step === 2 && !isOneClick && \(/);
  assert.match(source, /disabled=\{!applicationFormMode\}/);
  assert.match(source, />\s*선택하고 계속\s*</);
  assert.match(
    source,
    /const isDownloadedApplicationFlow =\s*!isOneClick && applicationFormMode === "upload"/,
  );
  assert.doesNotMatch(oneClickSteps, /작성 방식 선택/);
  assert.match(source, /setStep\(isOneClick \? 3 : 2\)/);
  assert.match(source, /applicationFormMode: applicationFormMode \?\? undefined/);
  assert.match(
    source,
    /mode === "online" && applicationFormMode === "upload"[\s\S]*setUploadedFiles[\s\S]*!isApplicationFormFile/,
  );
  assert.match(
    source,
    /setStep\(restoredIsOneClick \|\| restoredApplicationFormMode \? 3 : 2\)/,
  );
  assert.match(source, /emailSubmitConfirmed: false/);
  assert.match(
    actions,
    /if \(isOneClick && usesExternalApplicationForm\)[\s\S]*원클릭 접수와 파일 제출 방식은 함께 선택할 수 없습니다/,
  );
});

test("album uploads expose application files only in file-submission mode", () => {
  const source = read("src/features/submissions/album-wizard.tsx");

  assert.match(
    source,
    /const isAllowed = isAudioFile \|\| \(isDownloadedApplicationFlow && isFormFile\)/,
  );
  assert.match(
    source,
    /isDownloadedApplicationFlow[\s\S]*\.wav,\.mp3,\.zip,\.hwp,\.doc,\.docx[\s\S]*\.wav,\.mp3,\.zip,audio\/wav/,
  );
  assert.match(
    source,
    /isDownloadedApplicationFlow[\s\S]*"WAV\/MP3\/ZIP\/HWP\/DOC\/DOCX"[\s\S]*"WAV\/MP3\/ZIP"/,
  );
});

test("MV applications use a six-step exclusive form-mode flow", () => {
  const source = read("src/features/submissions/mv-wizard.tsx");
  const stepsStart = source.indexOf("const steps =");
  const stepsEnd = source.indexOf("const deferredPaymentNotice", stepsStart);
  const steps = source.slice(stepsStart, stepsEnd);

  for (const label of [
    "목적 선택",
    "작성 방식 선택",
    "신청서 작성",
    "파일 업로드",
    "결제하기",
    "접수 완료",
  ]) {
    assert.match(steps, new RegExp(`"${label}"`));
  }
  assert.match(
    source,
    /React\.useState<ApplicationFormMode \| null>\(null\)/,
  );
  assert.match(source, /\{step === 2 && \(/);
  assert.match(source, /disabled=\{!applicationFormMode\}/);
  assert.match(source, /\{step === 3 && \([\s\S]*신청서 작성/);
  assert.match(source, /\{step === 4 && \([\s\S]*파일 첨부/);
  assert.match(source, /\{step === 5 && \([\s\S]*신청 내용 확인/);
  assert.match(source, /\{step === 6 && \([\s\S]*접수 완료/);
  assert.match(source, /applicationFormMode: payload\.applicationFormMode/);
  assert.match(
    source,
    /mode === "online" && applicationFormMode === "upload"[\s\S]*setUploadedFiles[\s\S]*!isApplicationFormFile/,
  );
  assert.match(source, /setStep\(restoredApplicationFormMode \? 3 : 2\)/);
  assert.match(
    source,
    /const isAllowed = isVideoFile \|\| \(isDownloadedApplicationFlow && isFormFile\)/,
  );
  assert.match(
    source,
    /isDownloadedApplicationFlow[\s\S]*\.hwp,\.doc,\.docx[\s\S]*\.m4v,video\/\*/,
  );
});
