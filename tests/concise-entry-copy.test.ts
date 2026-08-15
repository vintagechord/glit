import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = (relativePath: string) =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

test("the home hero uses the review-record message", () => {
  const homePage = readSource("src/app/page.tsx");
  const translations = readSource(
    "src/components/i18n/english-language-pack.tsx",
  );

  assert.match(homePage, /내 작품의 심의 기록을 한곳에서 관리하세요/);
  assert.doesNotMatch(homePage, /신청 · 결제 · 결과를 한곳에서/);
  assert.match(
    translations,
    /"내 작품의 심의 기록을 한곳에서 관리하세요":/,
  );
});

test("application entry headers keep essentials without repeating the wizard steps", () => {
  const albumIntro = readSource(
    "src/features/submissions/album-intro-panel.tsx",
  );
  const mvPage = readSource("src/app/dashboard/new/mv/page.tsx");

  assert.match(albumIntro, />\s*음반 심의 접수\s*</);
  assert.match(albumIntro, /비회원 가능/);
  assert.doesNotMatch(albumIntro, /음반 심의 신청/);
  assert.doesNotMatch(albumIntro, /5단계 접수/);
  assert.match(albumIntro, /aria-expanded=\{isOpen\}/);
  assert.match(albumIntro, /aria-controls="album-preparation-checklist"/);
  assert.match(albumIntro, /id="album-preparation-checklist"/);

  assert.match(mvPage, />\s*뮤직비디오 심의 접수\s*</);
  assert.match(mvPage, /비회원 가능/);
  assert.match(mvPage, /영상 규격 확인/);
  assert.doesNotMatch(mvPage, /뮤직비디오 심의 신청/);
  assert.doesNotMatch(mvPage, /5단계 접수/);
});

test("application mode buttons use labels and pressed state without helper copy", () => {
  const source = readSource(
    "src/features/submissions/application-form-mode-tabs.tsx",
  );

  assert.match(source, /온라인 작성/);
  assert.match(source, /파일로 제출/);
  assert.match(source, /aria-pressed=\{mode === "online"\}/);
  assert.match(source, /aria-pressed=\{isUploadMode\}/);
  assert.match(source, /min-h-\[3\.25rem\]/);
  assert.match(source, /sm:grid-cols-2/);
  assert.doesNotMatch(source, /화면에서 바로 입력/);
  assert.doesNotMatch(source, /양식 작성 후 첨부/);
});

test("the legacy form page presents one concise explanation and an accessible link", () => {
  const source = readSource("src/app/forms/page.tsx");

  assert.match(source, /오픈 후 1년간 함께 운영/);
  assert.match(source, /접수 후 심의 절차는 동일합니다/);
  assert.match(source, /aria-label="예전 온사이드 사이트 열기 \(새 창\)"/);
  assert.match(source, /rel="noopener noreferrer"/);
  assert.doesNotMatch(source, /필독/);
  assert.doesNotMatch(source, /진행 현황과 결제 기록 관리/);
  assert.doesNotMatch(source, /새 온사이드에서는 신청, 결제/);
  assert.doesNotMatch(source, /예전 사이트 이용이 더 편하신 경우에만/);
});

test("lookup and auth pages remove repeated headers while retaining required controls", () => {
  const trackPage = readSource("src/app/track/page.tsx");
  const trackDetail = readSource("src/app/track/[token]/page.tsx");
  const trackForm = readSource("src/features/track/track-lookup-form.tsx");
  const loginPage = readSource("src/app/login/page.tsx");
  const loginForm = readSource("src/features/auth/login-form.tsx");
  const forgotPassword = readSource("src/app/forgot-password/page.tsx");

  assert.doesNotMatch(trackPage, /진행\/결과 조회<\/p>/);
  assert.doesNotMatch(trackPage, /회원은 로그인 후 접수 현황으로 이동/);
  assert.doesNotMatch(trackPage, /접수 시 발급받은 조회 코드를 입력하면/);
  assert.doesNotMatch(trackDetail, /최신 진행 상황을 자동으로 갱신합니다/);
  assert.match(trackDetail, /refreshIntervalMs=\{10000\}/);
  assert.match(trackForm, /htmlFor="guest-track-token"/);
  assert.match(trackForm, /조회 코드 찾기/);

  assert.doesNotMatch(loginPage, /bauhaus-kicker mx-auto/);
  assert.match(loginPage, /<h1[^>]*>로그인<\/h1>/);
  assert.match(loginForm, /htmlFor="login-email"/);
  assert.match(loginForm, /htmlFor="login-password"/);
  assert.doesNotMatch(forgotPassword, /bauhaus-kicker mx-auto/);
  assert.doesNotMatch(forgotPassword, /가입 이메일을 입력하세요/);
  assert.match(forgotPassword, /htmlFor="reset-email"/);
});

test("remaining public labels have exact English translations", () => {
  const translations = readSource(
    "src/components/i18n/english-language-pack.tsx",
  );

  for (const label of [
    "비회원 가능",
    "음반 심의 접수",
    "뮤직비디오 심의 접수",
    "영상 규격 확인",
    "준비물 닫기",
    "작성 방식",
    "온라인 작성",
    "파일로 제출",
    "예전 사이트 열기",
    "예전 온사이드 사이트 열기 (새 창)",
    "구버전과 신버전은 오픈 후 1년간 함께 운영되며, 접수 후 심의 절차는 동일합니다.",
    "조회 방식을 선택하세요",
    "비회원 진행/결과 조회",
    "재설정 링크 받기",
  ]) {
    assert.ok(
      translations.includes(`"${label}":`),
      `missing exact English translation for: ${label}`,
    );
  }
});
