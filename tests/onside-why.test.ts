import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { ONSIDE_FAMILY, ONSIDE_REASONS, ONSIDE_WHY_FAQS, ONSIDE_WHY_PATH } from "../src/lib/onside-why";
import { organizationJsonLd, SITE_DESCRIPTION } from "../src/lib/seo";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("the brand family is the owner's list: Onside is 빈티지하우스's review brand beside its four other businesses", () => {
  // Owner 2026-11-16: 비트마켓 워터멜론, 아트상품 스토어 아트멜론, 뮤직 스튜디오 빈티지하우스, 수리 전문점 마하픽스.
  assert.deepEqual(ONSIDE_FAMILY.map((brand) => brand.name), ["온사이드", "워터멜론", "아트멜론", "빈티지하우스", "마하픽스"]);
  const by = Object.fromEntries(ONSIDE_FAMILY.map((brand) => [brand.name, brand]));
  assert.match(by["워터멜론"].description, /국내 유일.*비트마켓/);
  assert.match(by["아트멜론"].description, /음반.*굿즈.*아트상품/);
  assert.match(by["빈티지하우스"].description, /뮤직 스튜디오/);
  assert.match(by["마하픽스"].description, /수리 전문점/);
  assert.equal(by["워터멜론"].url, "https://www.iamwatermelon.com");
  assert.equal(by["아트멜론"].url, "https://artmelon.co.kr/");
  assert.equal(by["마하픽스"].url, "https://machfix.co.kr");
  // Owner 2026-11-16: the studio's site is vhouse.co.kr.
  assert.equal(by["빈티지하우스"].url, "https://vhouse.co.kr");
  // Every brand but Onside itself links to its own site.
  assert.deepEqual(ONSIDE_FAMILY.filter((brand) => !brand.url).map((brand) => brand.key), ["onside"]);
});

test("the reasons state what Onside does, without rankings or promises about results", () => {
  assert.equal(ONSIDE_REASONS.length, 6);
  const text = JSON.stringify([ONSIDE_REASONS, ONSIDE_WHY_FAQS]);
  for (const fact of ["2017년", "방송국 15곳", "영상물등급위원회", "멜론·지니", "조회 코드", "라디오 프로그램", "워터멜론", "마하픽스"]) assert.ok(text.includes(fact), fact);
  // Nothing the business cannot show: no "best", no rank, no pass or airplay guarantee.
  assert.doesNotMatch(text, /가장|최고|1위|유일한 심의|100%|보장|통과율|무조건/);
  for (const faq of ONSIDE_WHY_FAQS) assert.ok(faq.question.endsWith("?") && faq.answer.length > 20);
  assert.ok(ONSIDE_WHY_FAQS.some((faq) => faq.question.includes("음반 심의 대행")));
});

test("the about page is the place that makes the case, and the search terms sit where engines read them", () => {
  assert.equal(ONSIDE_WHY_PATH, "/about");
  const page = read("src/app/about/page.tsx");
  const content = read("src/components/about/about-content.tsx");
  // The phrase people search with, whole, in the title and the h1.
  assert.match(page, /title: "[^"]*음반 심의 대행[^"]*뮤직비디오 심의 대행[^"]*"/);
  assert.match(content, /<h1[\s\S]*?음반·뮤직비디오 심의 대행,[\s\S]*?<\/h1>/);
  for (const piece of ["ONSIDE_REASONS.map", "ONSIDE_FAMILY.map", "ONSIDE_WHY_FAQS.map", "GuideTrustFacts", 'href="/dashboard/new"']) assert.ok(content.includes(piece), piece);
  assert.match(read("src/components/about/about-json-ld.tsx"), /faqJsonLd\(ONSIDE_WHY_FAQS\)/);
  // The home description carries the whole phrase too.
  assert.match(SITE_DESCRIPTION, /음반 심의 대행/);
  assert.match(SITE_DESCRIPTION, /뮤직비디오 심의 대행/);
  assert.match(read("src/app/page.tsx"), /title: `\$\{SITE_NAME\} \| 음반 심의 대행 · 뮤직비디오 심의 대행/);
});

test("structured data and llms.txt name the operator's other brands", () => {
  const organization = organizationJsonLd() as { parentOrganization?: { name: string; brand: Array<{ name: string; url?: string }> } };
  assert.equal(organization.parentOrganization?.name, "(주)빈티지하우스");
  assert.deepEqual(organization.parentOrganization?.brand.map((brand) => brand.name), ["온사이드", "워터멜론", "아트멜론", "빈티지하우스", "마하픽스"]);
  const llms = read("src/lib/llms-text.ts");
  assert.match(llms, /ONSIDE_FAMILY/);
  assert.match(llms, /ONSIDE_REASONS/);
});

test("each review guide carries its whole search phrase, and the home page says both in plain text", () => {
  const guides = read("src/lib/review-guides.ts");
  // 음반심의대행 / 뮤직비디오심의대행: the words stay together in the title and the h1.
  assert.match(guides, /slug: "album-review",[\s\S]*?title: "음반 심의 대행[^"]*",\s*h1: "음반 심의 대행[^"]*",/);
  assert.match(guides, /slug: "mv-review",[\s\S]*?title: "뮤직비디오 심의 대행[^"]*",\s*h1: "뮤직비디오 심의 대행[^"]*",/);
  assert.match(read("src/app/page.tsx"), /음반 심의 대행과 뮤직비디오 심의 대행에 필요한 준비물, 비용, 접수 일정과 결과 확인 방법을 정리했습니다\./);
  // The page that makes the case ranks with the guides in the sitemap.
  assert.match(read("src/app/sitemap.ts"), /\{ path: "\/about", priority: 0\.9,/);
});

test("the about page copy is the owner's wording of 2026-11-20", () => {
  const reason = Object.fromEntries(ONSIDE_REASONS.map((entry) => [entry.key, entry]));
  assert.equal(reason.since.title.ko, "Since 2017");
  assert.equal(
    reason.family.body.ko,
    "(주)빈티지하우스는 온사이드를 포함해 비트마켓 워터멜론, 아트상품 스토어 아트멜론, 뮤직 스튜디오 빈티지하우스, 수리 전문점 마하픽스를 함께 운영합니다.",
  );
  assert.equal(
    reason.offices.body.ko,
    "TV·라디오 방송국 15곳의 음반 심의, 영상물등급위원회 등급분류와 방송국별 뮤직비디오 심의 등 국내 가능한 모든 심의 접수가 가능합니다.",
  );
  const content = read("src/components/about/about-content.tsx");
  assert.ok(content.includes('"빈티지하우스는 국내 뮤지션들과 함께 호흡하며 다양한 비즈니스를 진행하고 있습니다."'));
  assert.doesNotMatch(JSON.stringify(ONSIDE_REASONS) + content, /그 심의 브랜드|심의만 하는 곳이 아닙니다/);
});
