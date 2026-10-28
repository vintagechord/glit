import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = (relativePath: string) =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

test("the home hero keeps the primary heading without repeated supporting copy", () => {
  const homePage = readSource("src/app/page.tsx");
  const translations = readSource(
    "src/components/i18n/english-language-pack.tsx",
  );

  assert.match(homePage, /심의 신청부터/);
  assert.match(homePage, /결과 확인까지/);
  assert.doesNotMatch(homePage, /내 작품의 심의 기록을 한곳에서 관리하세요/);
  assert.doesNotMatch(homePage, /신청 · 결제 · 결과를 한곳에서/);
  assert.doesNotMatch(
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

test("application mode step makes the two submission methods mutually exclusive", () => {
  const source = readSource(
    "src/features/submissions/application-form-mode-tabs.tsx",
  );

  assert.match(source, /온라인 작성/);
  assert.match(source, /파일로 제출/);
  assert.match(source, /두 방식 중 하나만 선택하세요/);
  assert.match(source, /사이트에서 직접 입력/);
  assert.match(source, /양식을 내려받아 작성 후 첨부/);
  assert.match(source, /role="radiogroup"/);
  assert.match(source, /role="radio"/);
  assert.match(source, /aria-checked=\{mode === "online"\}/);
  assert.match(source, /aria-checked=\{isUploadMode\}/);
  assert.match(source, /aria-describedby="application-form-mode-help"/);
  assert.match(source, /min-h-\[7rem\]/);
  assert.match(source, /sm:grid-cols-2/);
});

test("the legacy form page presents one concise explanation and an accessible link", () => {
  const source = readSource("src/features/support/forms-page-view.tsx");

  assert.doesNotMatch(source, /오픈 후 1년간 함께 운영/);
  assert.match(source, /해당 사이트의 접수번호와 제출 안내를 따라 진행/);
  assert.match(source, /aria-label="예전 온사이드 사이트 열기 \(새 창\)"/);
  assert.match(source, /rel="noopener noreferrer"/);
  assert.doesNotMatch(source, /필독/);
  assert.doesNotMatch(source, /진행 현황과 결제 기록 관리/);
  assert.doesNotMatch(source, /새 온사이드에서는 신청, 결제/);
  assert.doesNotMatch(source, /예전 사이트 이용이 더 편하신 경우에만/);
});

test("lookup and auth pages remove repeated headers while retaining required controls", () => {
  const trackPage = readSource("src/features/track/track-page-view.tsx");
  const trackDetail = readSource("src/app/track/[token]/page.tsx");
  const trackForm = readSource("src/features/track/track-lookup-form.tsx");
  const loginPage = readSource("src/features/auth/login-page-view.tsx");
  const loginForm = readSource("src/features/auth/login-form.tsx");
  const forgotPassword = readSource("src/app/forgot-password/page.tsx");

  assert.doesNotMatch(trackPage, /진행\/결과 조회<\/p>/);
  assert.doesNotMatch(trackPage, /회원은 로그인 후 접수 현황으로 이동/);
  assert.doesNotMatch(trackPage, /접수 시 발급받은 조회 코드를 입력하면/);
  assert.doesNotMatch(trackDetail, /최신 진행 상황을 자동으로 갱신합니다/);
  assert.match(trackDetail, /refreshIntervalMs=\{10000\}/);
  assert.match(trackForm, /htmlFor="guest-track-token"/);
  assert.match(trackForm, /조회 코드를 이메일로 받기/);

  assert.doesNotMatch(loginPage, /bauhaus-kicker mx-auto/);
  assert.equal((loginPage.match(/<h1\b/g) ?? []).length, 1);
  assert.match(loginPage, /<h1[^>]*>[\s\S]*?"로그인"[\s\S]*?<\/h1>/);
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
    "사전 준비 사항 닫기",
    "작성 방식",
    "작성 방식 선택",
    "두 방식 중 하나만 선택하세요.",
    "온라인 작성",
    "사이트에서 직접 입력",
    "파일로 제출",
    "양식을 내려받아 작성 후 첨부",
    "선택하고 계속",
    "예전 사이트 열기",
    "예전 온사이드 사이트 열기 (새 창)",
    "기존 사이트에서 접수한 신청은 해당 사이트의 접수번호와 제출 안내를 따라 진행해주세요.",
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
