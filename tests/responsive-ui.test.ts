import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = (relativePath: string) =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

test("mobile header keeps account actions compact and accessible", () => {
  const source = readSource("src/components/site/header.tsx");

  assert.match(source, /const subtleButtonClass =\s*\n\s*"[^"]*w-10/);
  assert.match(source, /const primaryButtonClass =\s*\n\s*"[^"]*w-10/);
  assert.match(source, /aria-label=\{isEnglishRoute \? "Login" : "로그인"\}/);
  assert.match(source, /<LogIn className="h-4 w-4 sm:hidden"/);
  assert.match(source, /<UserPlus className="h-4 w-4 sm:hidden"/);
});

test("dashboard status dialogs collapse three columns on narrow viewports", () => {
  for (const relativePath of [
    "src/components/dashboard/submission-status-list.tsx",
    "src/components/dashboard/history-list.tsx",
  ]) {
    const source = readSource(relativePath);

    assert.match(
      source,
      /grid-cols-\[minmax\(0,1fr\)_minmax\(100px,auto\)\]/,
    );
    assert.match(
      source,
      /sm:grid-cols-\[minmax\(0,1\.4fr\)_minmax\(110px,0\.8fr\)_96px\]/,
    );
    assert.match(source, /max-h-\[calc\(100dvh-2rem\)\]/);
    assert.match(source, /className="hidden text-right[^\"]*sm:block"/);
  }
});

test("central dialog host is bounded by the dynamic viewport", () => {
  const source = readSource("src/components/ui/centered-dialog-host.tsx");

  assert.match(source, /max-h-\[calc\(100dvh-3rem\)\]/);
  assert.match(source, /overflow-y-auto/);
  assert.match(source, /event\.key !== "Tab"/);
  assert.match(source, /document\.body\.style\.overflow = "hidden"/);
});

test("mobile form controls avoid focus zoom", () => {
  const source = readSource("src/app/globals.css");

  assert.match(source, /@media \(max-width: 639px\) and \(pointer: coarse\)/);
  assert.match(source, /input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\)/);
  assert.match(source, /font-size: 16px/);
  assert.match(source, /min-height: 100vh;\s*min-height: 100dvh;/);
});

test("dashboard navigation and cart stay compact on narrow screens", () => {
  const shell = readSource("src/components/dashboard/dashboard-shell.tsx");
  const cart = readSource(
    "src/components/dashboard/submission-cart-checkout.tsx",
  );

  assert.match(shell, /label: "작성중"/);
  assert.match(shell, /label: "심의내역"/);
  assert.match(shell, /aria-current=\{activeTab === tab\.key \? "page"/);
  assert.match(cart, /grid-cols-\[36px_minmax\(0,1fr\)\]/);
  assert.match(cart, /<dl className="[^"]*grid-cols-\[52px_minmax\(0,1fr\)\]/);
  assert.doesNotMatch(
    cart,
    /선택한 신청서를 KG이니시스 카드 결제로 한 번에 결제합니다/,
  );
});

test("credit details use progressive disclosure instead of repeated guidance", () => {
  const source = readSource("src/app/mypage/credits/page.tsx");

  assert.match(source, /<summary className="cursor-pointer font-black">이용 안내<\/summary>/);
  assert.match(source, />사용 내역<\/h2>/);
  assert.match(source, /적립 내역/);
  assert.doesNotMatch(source, /결제 완료 음반심의 1건 = 1크레딧/);
  assert.doesNotMatch(source, /지금 교환 가능한 잔여 크레딧/);
  assert.match(source, /submission\.release_date \?\? "-"/);
});

test("compact application UX stays translated and accessible", () => {
  const translations = readSource(
    "src/components/i18n/english-language-pack.tsx",
  );
  const aiSelector = readSource(
    "src/features/submissions/ai-usage-selector.tsx",
  );

  for (const label of [
    "비회원 가능",
    "로그인 시 자동 저장",
    "5단계 접수",
    "영상 규격 확인",
    "신청 진행 단계",
    "전체 진행률",
    "작성 방식",
    "작성 방식 선택",
    "두 방식 중 하나만 선택하세요.",
    "온라인 작성",
    "사이트에서 직접 입력",
    "파일로 제출",
    "양식을 내려받아 작성 후 첨부",
    "선택하고 계속",
  ]) {
    assert.match(translations, new RegExp(`"${label}":`));
  }
  assert.match(translations, /\\\(현재 단계\\\)/);
  assert.match(aiSelector, /className="sr-only"> \(필수\)<\/span>/);
});
