import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_HERO_SLIDES,
  HERO_INTERVAL_DEFAULT,
  HERO_MAX_SLIDES,
  estimateHeadlineEm,
  heroHeadingSlideId,
  normalizeHeroBannerInput,
  normalizeHeroInterval,
  safeHeroLink,
  toHeroSlides,
  type HeroBannerRow,
} from "../src/lib/home-hero-banners";

const row = (over: Partial<HeroBannerRow>): HeroBannerRow => ({
  id: "00000000-0000-4000-8000-000000000001", design: "record", badge: null,
  headline_1: "음반·뮤직비디오 심의,", headline_2: "이제 더 간편하게", body: null,
  badge_en: null, headline_1_en: null, headline_2_en: null, body_en: null,
  link_url: null, sort_order: 0, is_active: true, ...over,
});

test("the built-in banners are the brand banner, the released-album URL banner, the MV certificate banner and the case for Onside", () => {
  assert.deepEqual(DEFAULT_HERO_SLIDES.map((slide) => slide.design), ["record", "url", "certificate", "reasons"]);
  // Owner 2026-11-16: few reach the footer's 회사소개, so a banner leads to it.
  assert.equal(DEFAULT_HERO_SLIDES[3].linkUrl, "/about");
  assert.match(DEFAULT_HERO_SLIDES[3].ko.headline.join(" "), /왜 온사이드/);
  assert.ok(DEFAULT_HERO_SLIDES[3].ko.body, "the banner says where it leads");
  // Owner 2026-11-11 and 2026-11-16: these headlines are the owner's words.
  assert.deepEqual(DEFAULT_HERO_SLIDES[0].ko.headline, ["음반·뮤직비디오 심의,", "이제 더 간편하게"]);
  assert.deepEqual(DEFAULT_HERO_SLIDES[1].ko.headline, ["이미 발매된 음원은", "URL만 입력하면 끝"]);
  assert.equal(DEFAULT_HERO_SLIDES[1].linkUrl, "/dashboard/new/album");
  assert.match(DEFAULT_HERO_SLIDES[2].ko.headline.join(" "), /필증/);
  assert.equal(DEFAULT_HERO_SLIDES[2].linkUrl, "/guide/mv-review");
  for (const slide of DEFAULT_HERO_SLIDES) assert.ok(slide.en?.headline, `${slide.design} has its English headline`);
});

test("saved banners show in their saved order; switched-off and broken rows are left out", () => {
  const slides = toHeroSlides([
    row({ id: "c", design: "certificate", headline_1: "뮤직비디오 유통에는", headline_2: "심의 필증이 필요합니다", body: "미리 신청하세요", sort_order: 30, link_url: "/guide/mv-review" }),
    row({ id: "a", sort_order: 10, badge: "Since 2017" }),
    row({ id: "off", sort_order: 15, is_active: false }),
    row({ id: "bad-design", sort_order: 16, design: "sparkles" as never }),
    row({ id: "empty", sort_order: 17, headline_1: "   " }),
    row({ id: "b", design: "url", headline_1: "이미 발매된 음원은", headline_2: "URL만 입력하면 끝", sort_order: 20, link_url: "javascript:alert(1)" }),
  ]);
  assert.deepEqual(slides.map((slide) => slide.id), ["a", "b", "c"]);
  assert.equal(slides[0].ko.badge, "Since 2017");
  assert.equal(slides[1].linkUrl, null, "an unsafe link is dropped, the banner stays");
  assert.equal(slides[2].ko.body, "미리 신청하세요");
  assert.equal(slides[2].linkUrl, "/guide/mv-review");
});

test("the home page never loses its banner: no saved banner falls back to the built-in set", () => {
  assert.deepEqual(toHeroSlides([]), DEFAULT_HERO_SLIDES);
  assert.deepEqual(toHeroSlides([row({ is_active: false })]).map((slide) => slide.design), ["record"], "all switched off leaves the brand banner");
  const many = toHeroSlides(Array.from({ length: 12 }, (_, index) => row({ id: `id-${index}`, sort_order: index })));
  assert.equal(many.length, HERO_MAX_SLIDES);
});

test("English text is used per field when it was entered, otherwise the Korean text stands", () => {
  const [slide] = toHeroSlides([row({ badge: "Since 2017", headline_1_en: "Album & MV Reviews,", headline_2_en: "Now Made Simple", body: "본문", body_en: "  " })]);
  assert.deepEqual(slide.en?.headline, ["Album & MV Reviews,", "Now Made Simple"]);
  assert.equal(slide.en?.badge, null);
  assert.equal(slide.en?.body, null);
  const [plain] = toHeroSlides([row({})]);
  assert.equal(plain.en, null);
});

test("the page's main heading stays with the brand banner wherever it is in the order", () => {
  const slides = toHeroSlides([
    row({ id: "u", design: "url", sort_order: 1 }),
    row({ id: "r", design: "record", sort_order: 2 }),
  ]);
  assert.equal(heroHeadingSlideId(slides), "r");
  assert.equal(heroHeadingSlideId(toHeroSlides([row({ id: "u", design: "url" })])), "u");
});

test("links are internal paths or https addresses only", () => {
  assert.equal(safeHeroLink("/dashboard/new/album"), "/dashboard/new/album");
  assert.equal(safeHeroLink(" https://artmelon.co.kr/ "), "https://artmelon.co.kr/");
  for (const bad of ["//evil.example", "javascript:alert(1)", "http://plain.example", "data:text/html,x", "/\\evil", "dashboard", "", null, undefined]) {
    assert.equal(safeHeroLink(bad as string), null, String(bad));
  }
});

test("the headline size follows the longer line, so an edited headline still fits on its line", () => {
  // The brand headline keeps the size it was designed at (9.6em in Korean, 11.2em in English).
  assert.ok(estimateHeadlineEm(["음반·뮤직비디오 심의,", "이제 더 간편하게"]) <= 9.6);
  assert.ok(estimateHeadlineEm(["Album & MV Reviews,", "Now Made Simple"]) <= 11.2);
  const long = estimateHeadlineEm(["유통사에 보낼 뮤직비디오라면 반드시", "필증"]);
  assert.ok(long > 15 && long < 19, String(long));
  assert.ok(estimateHeadlineEm(["가나다", ""]) < estimateHeadlineEm(["가나다라마바사", ""]));
});

test("admin input is trimmed, bounded and refused when it has no headline or an unknown design", () => {
  const ok = normalizeHeroBannerInput({
    design: "certificate", badge: " ", headline1: "  뮤직비디오 유통에는 ", headline2: "심의 필증이 필요합니다", body: " 미리 신청하세요 ",
    badgeEn: "", headline1En: "Music videos need a", headline2En: "rating certificate", bodyEn: "",
    linkUrl: " /guide/mv-review ", sortOrder: "30", isActive: true,
  });
  assert.ok(ok.ok);
  assert.deepEqual(ok.ok && ok.value, {
    design: "certificate", badge: null, headline_1: "뮤직비디오 유통에는", headline_2: "심의 필증이 필요합니다", body: "미리 신청하세요",
    badge_en: null, headline_1_en: "Music videos need a", headline_2_en: "rating certificate", body_en: null,
    link_url: "/guide/mv-review", sort_order: 30, is_active: true,
  });
  const base = { design: "record", headline1: "제목", sortOrder: 0, isActive: true };
  assert.equal(normalizeHeroBannerInput({ ...base, headline1: " " }).ok, false);
  assert.equal(normalizeHeroBannerInput({ ...base, design: "poster" }).ok, false);
  assert.equal(normalizeHeroBannerInput({ ...base, headline1: "가".repeat(41) }).ok, false);
  assert.equal(normalizeHeroBannerInput({ ...base, linkUrl: "javascript:alert(1)" }).ok, false, "a link that would be dropped is refused, so the admin sees why");
  assert.equal(normalizeHeroBannerInput({ ...base, sortOrder: "abc" }).ok && true, true, "a blank order becomes 0");
});

test("the slide interval stays within a readable range", () => {
  assert.equal(normalizeHeroInterval(undefined), HERO_INTERVAL_DEFAULT);
  assert.equal(normalizeHeroInterval({ intervalSeconds: 9 }), 9);
  assert.equal(normalizeHeroInterval({ intervalSeconds: 1 }), 4);
  assert.equal(normalizeHeroInterval({ intervalSeconds: 90 }), 20);
  assert.equal(normalizeHeroInterval({ intervalSeconds: "x" }), HERO_INTERVAL_DEFAULT);
});
