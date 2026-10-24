import assert from "node:assert/strict";
import test from "node:test";
import { performance } from "node:perf_hooks";
import { analyzeLyricsProfanity, LYRICS_PROFANITY_LIMITS } from "../src/lib/profanity/check";

test("lyrics analysis detects literal, Unicode, jamo, leet and combined evasion forms", () => {
  const samples = [
    "씨발", "시발", "씨@발", "시1발", "씨 발", "씨\n발", "개시발", "개씨발", "이런씨발",
    "ㅆㅣㅂㅏㄹ", "ㅅ ㅣ ㅂ ㅏ ㄹ", "ㅅ.ㅣ*ㅂ-ㅏ/ㄹ", "씨발".normalize("NFD"),
    "병신", "ㅂ ㅕ ㅇ ㅅ ㅣ ㄴ", "개 새 끼", "존ㄴㅏ", "좆", "지 랄",
    "fuck", "f.u.c.k", "f u c k", "f\nu\nc\nk", "f*ck", "f#ck", "f_ck", "f**k", "phuck", "fvck",
    "fuuuuuck", "f u u u c k", "f.u.u.u.c.k", "motherfucker", "motherf*cker", "bullshit",
    "sh1t", "s#h!t", "b1tch", "$hit", "ＦＵＣＫ", "𝐅𝐔𝐂𝐊", "fuсk", "f\u0301u\u0301ck",
    "퍽유", "퍽 유", "뻐큐",
    "fuckin", "fukkin", "motherfuckin", "muthafucka", "muthafuckin", "nigga", "nigger", "faggot", "n1gga",
    "씨바", "씨벌", "씨부랄", "씹새끼", "엿먹어", "씨x발", "시X발", "병X신", "ㅅl발", "ㅆl발", "ㅆI발",
  ];
  for (const text of samples) {
    const result = analyzeLyricsProfanity(text);
    assert.equal(result.hasProfanity, true, text);
    assert.equal(result.truncated, false, text);
    assert.ok(result.matches.some(match => match.category === "confident"), text);
    for (const match of result.matches) assert.equal(text.slice(match.start, match.end), match.matchedText, text);
  }
});

test("ordinary Korean phrases and English words do not become profanity when whitespace is removed", () => {
  const samples = [
    "시발점부터 다시 시작합니다", "시발역에서 기차를 타요", "시발지를 확인해요", "시발점과 시발역",
    "조개와 신발 그리고 쪽빛 바다", "새끼손가락과 새끼발가락", "새끼고양이", "비취색 비취빛 목걸이", "비치웨어", "비취 반지", "비취 보석", "새끼 고양이", "새끼 손가락",
    "다시 발걸음을 옮겨", "잠시 발을 멈춰", "질병 신호를 알아봐", "생존 나비", "집시 발레", "다\u200b시 발걸음",
    "다시\n발걸음을 옮겨", "질병\n신호를 알아봐", "퍽 유독 예쁜 밤", "비취빛은 푸르고", "날씨 발표", "날씨발표",
    "assignment Scunthorpe hello", "class pass assistant passion classic", "Dickens and damnation", "fuchsia sushi tissue",
    "scun\u200bthorpe", "xfuck", "fuckery", "불빛을 켜고 노래해",
    "시바견과 씨바견", "십팔 세", "십 팔", "시베리아", "달콤한 호박엿 먹어요", "Nigel and Nigeria",
  ];
  for (const text of samples) {
    const result = analyzeLyricsProfanity(text);
    assert.deepEqual(result.matches, [], text);
    assert.equal(result.hasProfanity, false, text);
    assert.equal(result.hasSuspectedProfanity, false, text);
  }
});

test("ambiguous pronunciation and initials are review candidates, not confident claims", () => {
  for (const text of ["비취", "비치", "뻐킹", "퍼킹", "쉣", "ㅅㅂ", "ㅂㅅ", "새끼", "damn", "dick", "pussy", "c발"]) {
    const result = analyzeLyricsProfanity(text);
    assert.equal(result.hasProfanity, false, text);
    assert.equal(result.hasSuspectedProfanity, true, text);
    assert.ok(result.matches.every(match => match.category === "suspected" && match.reason), text);
  }
  const explicit = analyzeLyricsProfanity("개새끼");
  assert.equal(explicit.hasProfanity, true);
  assert.equal(explicit.hasSuspectedProfanity, false);
  assert.equal(explicit.matches.length, 1);
});

test("raw UTF-16 spans survive emoji, combining marks, fullwidth text and repeated separators", () => {
  const pieces = ["씨@발", "f\u200bu\u200bc\u200bk", "𝐅𝐔𝐂𝐊", "f.u.u.u.c.k", "비취"];
  const text = `😀 맑은 노래\n${pieces.join(" / ")}!`;
  const result = analyzeLyricsProfanity(text);
  assert.equal(result.matches.length, pieces.length);
  assert.deepEqual(result.matches.map(match => match.matchedText), pieces);
  for (let index = 0; index < pieces.length; index++) {
    const match = result.matches[index];
    assert.equal(match.start, text.indexOf(pieces[index]));
    assert.equal(match.end, match.start + pieces[index].length);
    assert.equal(text.slice(match.start, match.end), match.matchedText);
    if (index) assert.ok(result.matches[index - 1].end <= match.start);
  }
});

test("run compression preserves actual word boundaries at both edges", () => {
  for (const text of ["of fuck", "fuck kitchen", "of f u u c k kitchen", "fuck fuck", "f f u u c c k k"]) {
    const result = analyzeLyricsProfanity(text);
    assert.equal(result.hasProfanity, true, text);
    assert.ok(result.matches.every(match => !match.matchedText.includes("of") && !match.matchedText.includes("kitchen")), text);
  }
  assert.equal(analyzeLyricsProfanity("fuck fuck").matches.length, 2);
  assert.equal(analyzeLyricsProfanity("offuck kitchen").hasProfanity, false);
});

test("safe compounds only exempt their own span; explicit configured terms take precedence", () => {
  for (const text of ["시발점 씨발", "시발 역겨워", "시발역겨워", "시발 지랄", "시발지랄"]) {
    assert.equal(analyzeLyricsProfanity(text).hasProfanity, true, text);
  }
  assert.equal(analyzeLyricsProfanity("시발점").hasProfanity, false);
  const override = analyzeLyricsProfanity("시발점", [{ term: "시발점", language: "KO" }]);
  assert.equal(override.hasProfanity, true);
  assert.equal(override.matches[0].matchedText, "시발점");
  assert.match(override.matches[0].ruleId, /^lyrics_custom_/);
});

test("administrator terms are literal data and preserve boundaries and spans", () => {
  const extra = [{ term: "나쁜말", language: "KO" }, { term: "bad dad", language: "EN" }, { term: "a+b", language: "EN" }];
  const text = "나.쁜-말 / bad dad / a+b";
  const result = analyzeLyricsProfanity(text, extra);
  assert.deepEqual(result.matches.map(match => match.matchedText), ["나.쁜-말", "bad dad", "a+b"]);
  assert.equal(analyzeLyricsProfanity("aaaaaaaa", [{ term: "a+b", language: "EN" }]).hasProfanity, false);
  assert.equal(analyzeLyricsProfanity("bad daddy", [{ term: "bad dad", language: "EN" }]).hasProfanity, false);
});

test("analysis explicitly reports bounded input, output and administrator configuration", () => {
  const beyond = "가".repeat(LYRICS_PROFANITY_LIMITS.textLength) + "씨발";
  const clipped = analyzeLyricsProfanity(beyond);
  assert.equal(clipped.truncated, true);
  assert.equal(clipped.sourceLength, beyond.length);
  assert.equal(clipped.analyzedLength, LYRICS_PROFANITY_LIMITS.textLength);
  const many = analyzeLyricsProfanity("씨발\n".repeat(2_000));
  assert.equal(many.hasProfanity, true);
  assert.equal(many.truncated, true);
  assert.equal(many.matches.length, LYRICS_PROFANITY_LIMITS.matches);
  const tooManyTerms = Array.from({ length: LYRICS_PROFANITY_LIMITS.extraTerms + 1 }, (_, index) => ({ term: `term${index}`, language: "EN" }));
  assert.equal(analyzeLyricsProfanity("clean", tooManyTerms).truncated, true);
  assert.equal(analyzeLyricsProfanity("clean", [{ term: "a".repeat(LYRICS_PROFANITY_LIMITS.termLength + 1), language: "EN" }]).truncated, true);
});

test("adversarial separated runs and large safe text remain bounded without regex backtracking", { timeout: 6_000 }, () => {
  const started = performance.now();
  const separated = analyzeLyricsProfanity("f ".repeat(50_000));
  assert.equal(separated.hasProfanity, false);
  assert.equal(separated.truncated, false);
  const terms = Array.from({ length: LYRICS_PROFANITY_LIMITS.extraTerms }, (_, index) => ({ term: `unlikely${index}term`, language: "EN" }));
  const large = analyzeLyricsProfanity("시발점에서 새로운 노래를 시작해요 ".repeat(50_000), terms);
  assert.equal(large.hasProfanity, false);
  assert.equal(large.truncated, true);
  assert.ok(performance.now() - started < 4_000, "bounded analysis should not exhibit quadratic separator matching");
});
