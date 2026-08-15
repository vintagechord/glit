import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const languagePack = readFileSync(
  new URL("../src/components/i18n/english-language-pack.tsx", import.meta.url),
  "utf8",
);

test("credit action labels have exact English translations", () => {
  const expectedTranslations = [
    ["보유 크레딧", "Available Credits"],
    ["크레딧 현황", "Credit Overview"],
    ["크레딧 사용", "Use Credits"],
    ["음반 1건 = +1", "1 Album = +1 Credit"],
    ["1크레딧", "1 Credit"],
    ["요청 내역", "Request History"],
    ["매거진 · 서비스", "Magazine · Services"],
    ["사용 내역", "Usage History"],
    ["적립 내역", "Earning History"],
    ["매거진 발행 요청", "Magazine Publication Request"],
    ["매거진 발행 요청하기", "Request Magazine Publication"],
    ["아티스트·앨범 콘텐츠 발행", "Publish Artist and Album Content"],
    ["서비스 이용 요청", "Service Request"],
    ["서비스 이용 요청하기", "Request a Service"],
    ["요청하기", "Request"],
    ["서비스 보기", "View Services"],
    ["전체 요청 보기", "View All Requests"],
    ["요청 내역이 없습니다.", "No request history yet."],
    ["1크레딧으로 발행 요청", "Request publication with 1 credit"],
    ["녹음실 등 관리자 등록 서비스", "Admin-registered services such as studios"],
  ] as const;

  for (const [korean, english] of expectedTranslations) {
    assert.ok(
      languagePack.includes(`"${korean}": "${english}"`),
      `missing exact English translation for: ${korean}`,
    );
  }
});
