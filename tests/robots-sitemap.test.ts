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
