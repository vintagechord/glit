import assert from "node:assert/strict";
import test from "node:test";

import { suggestEmailFix } from "../src/lib/email-typo";

// 2026-11-15 a guest typed hanmail.met and every application mail bounced.
test("a mistyped ending of a single-domain Korean or global provider is suggested back", () => {
  assert.equal(suggestEmailFix("artist@hanmail.met"), "artist@hanmail.net");
  assert.equal(suggestEmailFix("a@gmail.con"), "a@gmail.com");
  assert.equal(suggestEmailFix("a@gmail.co"), "a@gmail.com");
  assert.equal(suggestEmailFix("a@gmail.net"), "a@gmail.com");
  assert.equal(suggestEmailFix("a@gmail"), "a@gmail.com");
  assert.equal(suggestEmailFix("a@naver.cpm"), "a@naver.com");
  assert.equal(suggestEmailFix("a@hanmail.com"), "a@hanmail.net");
  assert.equal(suggestEmailFix("a@daum.met"), "a@daum.net");
  assert.equal(suggestEmailFix("a@nate.con"), "a@nate.com");
  assert.equal(suggestEmailFix("a@kakao.co.kr"), "a@kakao.com");
});

test("one wrong, missing, extra or swapped letter in a longer provider name is suggested", () => {
  assert.equal(suggestEmailFix("a@gmial.com"), "a@gmail.com");
  assert.equal(suggestEmailFix("a@gmai.com"), "a@gmail.com");
  assert.equal(suggestEmailFix("a@hanmial.net"), "a@hanmail.net");
  assert.equal(suggestEmailFix("a@hamail.net"), "a@hanmail.net");
  assert.equal(suggestEmailFix("a@nver.com"), "a@naver.com");
  assert.equal(suggestEmailFix("a@navver.com"), "a@naver.com");
  assert.equal(suggestEmailFix("a@hotmal.com"), "a@hotmail.com");
  assert.equal(suggestEmailFix("a@outlok.com"), "a@outlook.com");
});

test("the local part is kept as typed; only the domain is fixed", () => {
  assert.equal(suggestEmailFix(" Abc.Def+mv@Hanmail.Met "), "Abc.Def+mv@hanmail.net");
  assert.equal(suggestEmailFix("first@second@gmial.com"), "first@second@gmail.com");
});

test("correct addresses, real look-alike domains and unfinished input get no hint", () => {
  for (const value of [
    "a@naver.com", "a@hanmail.net", "a@daum.net", "a@gmail.com", "a@kakao.com", "a@icloud.com", "a@nate.com",
    "a@mail.com", "a@email.com", "a@hotmail.co.uk", "a@hotmail.co.kr", "a@outlook.kr", "a@yahoo.co.jp",
    "a@company.co.kr", "a@gate.com", "a@note.com", "a@datum.net", "a@googlemail.com", "a@korea.kr",
    "", "a", "a@", "@gmail.com", "a@.com",
  ]) {
    assert.equal(suggestEmailFix(value), null, value);
  }
});
