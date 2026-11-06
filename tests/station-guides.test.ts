import assert from "node:assert/strict";
import test from "node:test";

import { buildLlmsText } from "../src/lib/llms-text";
import { GLOSSARY_TERM_COUNT, REVIEW_GLOSSARY } from "../src/lib/review-glossary";
import { GUIDE_TOPIC_LINKS } from "../src/lib/review-guide-links";
import { FALLBACK_ALBUM_PACKAGES } from "../src/lib/review-guides";
import { MV_STATION_PRICE_KRW } from "../src/lib/submission-station-selection";
import { getStationGuide, packagesIncluding, relatedStationGuides, STATION_GUIDES, stationFaqs, stationRadioGuide } from "../src/lib/station-guides";

test("every album station of the largest package and every music video station has a guide, and nothing else", () => {
  const albumCodes = FALLBACK_ALBUM_PACKAGES.at(-1)!.stationCodes;
  const mvCodes = Object.keys(MV_STATION_PRICE_KRW).filter((code) => !albumCodes.includes(code));
  assert.deepEqual(STATION_GUIDES.map((guide) => guide.code).sort(), [...albumCodes, ...mvCodes].sort());
  assert.equal(new Set(STATION_GUIDES.map((guide) => guide.slug)).size, STATION_GUIDES.length);
  for (const guide of STATION_GUIDES) {
    assert.match(guide.slug, /^[a-z0-9-]+$/, guide.code);
    assert.ok(guide.keywords.length >= 3 && guide.about.length >= 2 && guide.description.length > 60, guide.code);
    assert.equal(guide.album, albumCodes.includes(guide.code), `${guide.code} album flag`);
    if (!guide.album) assert.ok(guide.mv, `${guide.code} must take music video reviews`);
  }
  // Fallback and live packages carry codes in the same order as their names.
  for (const pkg of FALLBACK_ALBUM_PACKAGES) assert.equal(pkg.stationCodes.length, pkg.stations.length, pkg.name);
});

test("package membership, prices and the generated questions come from the catalog", () => {
  const kbs = getStationGuide("kbs")!;
  assert.deepEqual(packagesIncluding("KBS", FALLBACK_ALBUM_PACKAGES).map((pkg) => pkg.name), ["3곳 패키지", "7곳 패키지", "10곳 패키지", "13곳 패키지", "15곳 패키지"]);
  assert.deepEqual(packagesIncluding("GUGAK", FALLBACK_ALBUM_PACKAGES).map((pkg) => pkg.name), ["15곳 패키지"]);
  assert.deepEqual(packagesIncluding("ETN", FALLBACK_ALBUM_PACKAGES), []);
  const faqs = stationFaqs(kbs, FALLBACK_ALBUM_PACKAGES);
  assert.ok(faqs.some((faq) => faq.answer.includes("3곳 패키지(50,000원, KBS·MBC·SBS)")));
  assert.ok(faqs.some((faq) => faq.answer.includes(`${MV_STATION_PRICE_KRW.KBS.toLocaleString("ko-KR")}원`)));
  assert.ok(faqs.length >= 4 && new Set(faqs.map((faq) => faq.question)).size === faqs.length);
  const mnet = getStationGuide("mnet")!;
  assert.ok(stationFaqs(mnet, FALLBACK_ALBUM_PACKAGES).some((faq) => faq.answer.includes("30,000원(영상물등급위원회 등급분류)")));
  assert.equal(stationRadioGuide(kbs)?.participationLink?.name, "KBS 콩");
  assert.equal(stationRadioGuide(getStationGuide("kiss")!), null);
  assert.equal(stationRadioGuide(mnet), null);
  assert.equal(relatedStationGuides(kbs).length, 4);
  assert.ok(relatedStationGuides(kbs).slice(0, 2).every((guide) => guide.group === "지상파"));
  assert.equal(getStationGuide("nope"), null);
});

test("llms.txt lists the service facts, every guide, station and glossary term", () => {
  const text = buildLlmsText({ origin: "https://iamonside.com", packages: FALLBACK_ALBUM_PACKAGES });
  assert.match(text, /^# 온사이드 \(Onside\)\n\n> 온사이드는 2017년부터/);
  for (const needle of ["3곳 패키지: 50,000원", "15곳 패키지: 150,000원", "https://iamonside.com/guide/album-review", "https://iamonside.com/guide/stations/gugak", "https://iamonside.com/guide/pricing", "https://iamonside.com/guide/glossary", "온라인 유통용 기본(영상물등급위원회 등급분류): 30,000원", "## English", "iamonside@daum.net"]) {
    assert.ok(text.includes(needle), needle);
  }
  for (const section of REVIEW_GLOSSARY) for (const term of section.terms) assert.ok(text.includes(`- ${term.term}`), term.term);
  assert.equal(GLOSSARY_TERM_COUNT, REVIEW_GLOSSARY.reduce((sum, section) => sum + section.terms.length, 0));
  assert.ok(GLOSSARY_TERM_COUNT >= 20);
  assert.ok(text.length < 40_000, "keep llms.txt readable in one fetch");
  assert.deepEqual(GUIDE_TOPIC_LINKS.map((link) => link.path), ["/guide/stations", "/guide/pricing", "/guide/glossary"]);
});
