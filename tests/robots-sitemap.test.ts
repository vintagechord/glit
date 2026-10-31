import assert from "node:assert/strict";
import test from "node:test";

import robots from "../src/app/robots";
import sitemap from "../src/app/sitemap";

// Google applies the most specific (longest) matching rule; Allow wins ties.
const isAllowed = (path: string, allow: string[], disallow: string[]) => {
  const longest = (rules: string[]) => Math.max(-1, ...rules.filter((rule) => path.startsWith(rule)).map((rule) => rule.length));
  return longest(allow) >= longest(disallow);
};

test("every sitemap URL is crawlable under robots.txt", () => {
  const rules = robots().rules;
  const rule = Array.isArray(rules) ? rules[0] : rules;
  const allow = ([] as string[]).concat(rule.allow ?? []);
  const disallow = ([] as string[]).concat(rule.disallow ?? []);
  const entries = sitemap();
  assert.ok(entries.length > 10);
  for (const entry of entries) {
    const path = new URL(entry.url).pathname;
    assert.ok(isAllowed(path, allow, disallow), `${path} is listed in the sitemap but blocked by robots.txt`);
  }
});

test("member, operator, payment and token pages stay blocked", () => {
  const rules = robots().rules;
  const rule = Array.isArray(rules) ? rules[0] : rules;
  const allow = ([] as string[]).concat(rule.allow ?? []);
  const disallow = ([] as string[]).concat(rule.disallow ?? []);
  for (const path of ["/admin/payments", "/mypage/orders", "/dashboard/submissions/x", "/dashboard/cart", "/api/health", "/track/token", "/pay/inicis/return", "/en/mypage/cart"]) {
    assert.equal(isAllowed(path, allow, disallow), false, `${path} must not be crawlable`);
  }
  assert.equal(isAllowed("/dashboard/new/mv", allow, disallow), true);
});

test("search guides are listed, redirects and placeholder pages are not, AI crawlers are blocked", () => {
  const paths = sitemap().map((entry) => new URL(entry.url).pathname);
  for (const path of ["/guide/album-review", "/guide/mv-review", "/guide/broadcast-review", "/guide/radio-review", "/dashboard/new/album", "/dashboard/new/mv"]) {
    assert.ok(paths.includes(path), `${path} should be in the sitemap`);
  }
  assert.equal(paths.includes("/en/apply"), false, "redirecting aliases must not be listed");
  assert.equal(paths.includes("/studio"), false, "the placeholder Studio page is not indexable");
  const rules = ([] as Array<{ userAgent?: string | string[]; disallow?: string | string[] }>).concat(robots().rules);
  const blocked = rules.find((rule) => Array.isArray(rule.userAgent) && rule.userAgent.includes("GPTBot"));
  assert.ok(blocked && ([] as string[]).concat(blocked.disallow ?? []).includes("/"));
  for (const searchBot of ["Googlebot", "Yeti", "Daum", "bingbot"]) {
    assert.equal(rules.some((rule) => ([] as string[]).concat(rule.userAgent ?? []).includes(searchBot)), false, `${searchBot} must stay under the general rules`);
  }
});

test("the client-side guide link list matches the guide content", async () => {
  const { REVIEW_GUIDES } = await import("../src/lib/review-guides");
  const { REVIEW_GUIDE_LINKS } = await import("../src/lib/review-guide-links");
  assert.deepEqual(REVIEW_GUIDE_LINKS.map((link) => [link.slug, link.menuLabel]), REVIEW_GUIDES.map((guide) => [guide.slug, guide.menuLabel]));
});

test("English pages carry the English site name in their titles", async () => {
  const { pageMetadata } = await import("../src/lib/seo");
  assert.deepEqual(pageMetadata({ locale: "en", title: "Log in", description: "x", path: "/login", enPath: "/en/login" }).title, { absolute: "Log in | Onside" });
  assert.equal(pageMetadata({ title: "로그인", description: "x", path: "/login" }).title, "로그인");
});
