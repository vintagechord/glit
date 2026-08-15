import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../src/app/mypage/credits/page.tsx", import.meta.url),
  "utf8",
);

const sectionStart = (label: string) => {
  const start = source.indexOf(`aria-label="${label}"`);

  assert.notEqual(start, -1, `${label} 영역을 찾을 수 없습니다.`);
  return start;
};

const openingTagAt = (start: number) => {
  const tagStart = source.lastIndexOf("<section", start);
  const tagEnd = source.indexOf(">", start);

  assert.notEqual(tagStart, -1);
  assert.notEqual(tagEnd, -1);
  return source.slice(tagStart, tagEnd + 1);
};

test("credits page leads with balance and request history before its action zone", () => {
  const overviewStart = sectionStart("크레딧 현황");
  const actionsStart = sectionStart("크레딧 사용");
  const sourcesStart = source.indexOf('id="credit-sources"');

  assert.notEqual(sourcesStart, -1, "적립 내역 영역을 찾을 수 없습니다.");
  assert.ok(overviewStart < actionsStart, "현황은 사용 영역보다 먼저 보여야 합니다.");
  assert.ok(actionsStart < sourcesStart, "사용 영역은 적립 내역보다 먼저 보여야 합니다.");

  const overview = source.slice(overviewStart, actionsStart);

  assert.match(overview, /보유 크레딧/);
  assert.match(overview, /요청 내역/);
  assert.match(overview, /\bgrid\b/);
  assert.match(
    overview,
    /\b(?:sm|md|lg):grid-cols-(?:2|\[minmax\([^)]*\)_minmax\([^)]*\)\])/,
  );
});

test("credit actions fill the row and stack into two desktop choices", () => {
  const actionsStart = sectionStart("크레딧 사용");
  const sourcesStart = source.indexOf('id="credit-sources"');
  const actionTag = openingTagAt(actionsStart);
  const actions = source.slice(actionsStart, sourcesStart);

  assert.match(actionTag, /^<section/);
  assert.doesNotMatch(actionTag, /\bmax-w-/);
  assert.match(actions, /\bgrid\b/);
  assert.match(actions, /\b(?:sm|md|lg):grid-cols-2\b/);
  assert.match(actions, /매거진 발행 요청/);
  assert.match(actions, /서비스 이용 요청/);
  assert.match(
    actions,
    /href=\{`\$\{localePrefix\}\/magazine\?tab=magazine#credit-use`\}/,
  );
  assert.match(
    actions,
    /href=\{`\$\{localePrefix\}\/magazine\?tab=services#credit-use`\}/,
  );
});

test("credit earning history remains progressively disclosed", () => {
  const sourcesStart = source.indexOf('id="credit-sources"');
  const sources = source.slice(sourcesStart);

  assert.match(sources, /<details open=\{creditSourcesOpen\} className="group">/);
  assert.match(sources, /<summary className="[^"]*cursor-pointer[^"]*">/);
  assert.match(sources, /적립 내역/);
  assert.match(sources, /<CreditSourcePagination/);
});
