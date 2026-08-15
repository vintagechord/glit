import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = (relativePath: string) =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

const albumWizard = readSource(
  "src/features/submissions/album-wizard.tsx",
);
const mvWizard = readSource("src/features/submissions/mv-wizard.tsx");
const englishLanguagePack = readSource(
  "src/components/i18n/english-language-pack.tsx",
);

test("submission wizards use concise cart actions and outcome notices", () => {
  for (const source of [albumWizard, mvWizard]) {
    assert.match(source, />\s*장바구니에 담기\s*</);
    assert.match(source, />\s*담고 결제하기\s*</);
    assert.match(source, /신청서를 장바구니에 담았습니다\./);
    assert.match(source, /결제에 실패했습니다\. \$\{paymentFailureStorageNotice\}/);
    assert.match(source, /\? `\$\{(?:payload\.message|error)\} \$\{paymentFailureStorageNotice\}`/);

    assert.doesNotMatch(source, /장바구니 준비 완료/);
    assert.doesNotMatch(source, /여러 건 동시 결제/);
    assert.doesNotMatch(source, /장바구니에 담고 나중에 결제/);
    assert.doesNotMatch(source, /장바구니에서 결제하기/);
    assert.doesNotMatch(source, /결제가 완료되지 않아 신청서만 저장되었습니다/);
    assert.doesNotMatch(source, /결제 확인 후 진행 상태가 업데이트됩니다/);
  }
});

test("album readiness only surfaces incomplete blockers", () => {
  assert.match(
    albumWizard,
    /const albumPaymentBlockers = albumPaymentReadiness\.filter\(\(item\) => !item\.ready\)/,
  );
  assert.match(albumWizard, /\{albumPaymentBlockers\.map\(\(item\) => \(/);
  assert.match(albumWizard, /role="alert"/);
  assert.doesNotMatch(albumWizard, /\{albumPaymentReadiness\.map\(/);
  assert.match(albumWizard, /최종 결제 금액/);
  assert.doesNotMatch(albumWizard, />\s*결제금액\s*</);
  assert.doesNotMatch(albumWizard, />\s*총 할인\s*</);
});

test("one-click guidance uses the site card system and scannable required items", () => {
  assert.match(albumWizard, /rounded-\[14px\] border-2 border-\[#111111\]/);
  assert.match(albumWizard, /shadow-\[4px_4px_0_#111111\]/);
  assert.match(albumWizard, /aria-label="필수 제출 항목"/);
  assert.match(albumWizard, /\["멜론 링크", "접수자 정보", "음원 파일"\]\.map/);
  assert.doesNotMatch(albumWizard, /이미 발매된 음원에 한정된 서비스입니다/);
  assert.match(englishLanguagePack, /"원클릭 접수 안내": "One-Click Submission"/);
  assert.match(englishLanguagePack, /"멜론 링크": "Melon Link"/);
});

test("album packages stay compact while preserving comparison and station details", () => {
  assert.match(
    albumWizard,
    /grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5/,
  );
  assert.match(albumWizard, /aria-pressed=\{isActive\}/);
  assert.match(albumWizard, /<details className="group border-t-2/);
  assert.match(
    albumWizard,
    /includedStationsLabel = `포함 방송국 \$\{pkg\.stations\.length\}개`/,
  );
  assert.match(albumWizard, /\{pkg\.stations\.map\(\(station\) => \(/);
  assert.match(albumWizard, /setPackageConfirmTarget\(pkg\)/);
  assert.match(albumWizard, /setSelectedPackage\(packageConfirmTarget\)/);
  assert.match(albumWizard, /장르 조건 있음/);
  assert.match(
    albumWizard,
    /packageGuidance\[packageConfirmTarget\.stationCount\]\?\.conditional/,
  );
  assert.doesNotMatch(
    albumWizard,
    /text-left rounded-\[28px\] border p-6/,
  );
  assert.match(
    englishLanguagePack,
    /포함 방송국\\s\*\(\\d\+\)개\/g, "\$1 Broadcasters Included"/,
  );
});

test("selected album package badge does not shift the comparison rows", () => {
  const packageCards = albumWizard.slice(
    albumWizard.indexOf("{packages.map((pkg, index) =>"),
    albumWizard.indexOf("추가 앨범이 등록된 경우 패키지는 변경할 수 없습니다."),
  );

  assert.match(
    packageCards,
    /\{isActive \? \(\s*<span\s+aria-hidden="true"\s+className="mt-auto flex w-full justify-end pt-3"[\s\S]*?<span className=\{selectedBadgeClass\}>✓ 선택됨<\/span>/,
  );
  assert.match(
    packageCards,
    /className="[^"]*min-w-\[78px\][^"]*items-end[^"]*text-right"/,
  );
  assert.match(packageCards, /aria-pressed=\{isActive\}/);

  const finalPriceIndex = packageCards.indexOf(
    "{formatCurrency(discountedDisplayPrice)}원",
  );
  const selectedBadgeIndex = packageCards.indexOf(
    'className="mt-auto flex w-full justify-end pt-3"',
  );
  assert.ok(finalPriceIndex >= 0, "package final price should be rendered");
  assert.ok(
    selectedBadgeIndex > finalPriceIndex,
    "selection state should render after the comparable price rows",
  );

  const priceColumn = packageCards.match(
    /<div className="[^"]*items-end[^"]*text-right">([\s\S]*?)<\/div>/,
  )?.[1];
  assert.ok(priceColumn, "package price column should remain identifiable");
  assert.doesNotMatch(priceColumn, /✓ 선택됨/);
});

test("karaoke choices expose state without repeated selection copy", () => {
  const form = readSource("src/features/karaoke/karaoke-form.tsx");
  const status = readSource("src/features/karaoke/karaoke-status-panel.tsx");

  assert.match(form, /aria-label="기본 신청 비용"/);
  assert.match(form, /aria-label="태진 등록 요청"/);
  assert.match(form, /aria-label="금영 등록 요청"/);
  assert.match(form, /aria-pressed=\{paymentMethod === "BANK"\}/);
  assert.match(form, /aria-pressed=\{paymentMethod === "CARD"\}/);
  assert.doesNotMatch(form, /노래방 등록 신청하기/);
  assert.doesNotMatch(form, /태진\/금영 등록을/);
  assert.doesNotMatch(form, />\s*선택됨\s*</);
  assert.doesNotMatch(form, />\s*무통장\s*<\/p>/);
  assert.doesNotMatch(form, />\s*카드\s*<\/p>/);
  assert.doesNotMatch(status, /실시간으로 업데이트됩니다/);
});

test("magazine request keeps one login action and one credit heading", () => {
  const source = readSource(
    "src/features/magazine/magazine-request-form.tsx",
  );
  const page = readSource("src/app/magazine/page.tsx");

  assert.match(page, /aria-label="크레딧 현황"/);
  assert.match(page, /sm:grid-cols-2/);
  assert.match(page, /mypage\/credits#credit-requests/);
  assert.doesNotMatch(source, /lg:grid-cols-\[1fr_0\.88fr\]/);
  assert.match(source, /<section className="w-full/);
  assert.match(source, />\s*로그인\s*<\/Link>/);
  assert.match(source, /\? "발행 요청"/);
  assert.equal(
    (page.match(/<p className="text-xs font-black">보유 크레딧<\/p>/g) ?? [])
      .length,
    1,
  );
  assert.doesNotMatch(source, /크레딧 사용은 회원만 가능합니다/);
  assert.doesNotMatch(source, /로그인 후 보유 크레딧/);
  assert.doesNotMatch(source, />\s*로그인 후 크레딧 사용\s*<\/Link>/);
  assert.doesNotMatch(source, /크레딧 사용해서 발행 요청/);
});
