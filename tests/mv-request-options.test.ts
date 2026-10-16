import assert from "node:assert/strict";
import test from "node:test";

import { MV_DESIRED_RATING_OPTIONS, normalizeMvDesiredRating } from "../src/lib/mv-request-options";

test("MV desired ratings restore explicit age text from existing drafts", () => {
  const cases = [
    ["전체", "전체관람가"],
    ["전체 관람가", "전체관람가"],
    ["ALL", "전체관람가"],
    ["12", "12세이상관람가"],
    ["만 12세 이상", "12세이상관람가"],
    ["15세", "15세이상관람가"],
    ["15세 이상 관람가", "15세이상관람가"],
    ["19", "청소년관람불가"],
    ["19세 이상", "청소년관람불가"],
    ["청소년 관람 불가", "청소년관람불가"],
    ["청소년관람불가 (19세)", "청소년관람불가"],
  ];
  for (const [input, expected] of cases) {
    assert.equal(normalizeMvDesiredRating(input), expected, input);
  }
  for (const option of MV_DESIRED_RATING_OPTIONS) {
    assert.equal(normalizeMvDesiredRating(option.value), option.value);
  }
});

test("missing and ambiguous old rating text never selects a rating by guesswork", () => {
  for (const input of [undefined, null, "", " ", "7세", "12/15", "12세 또는 15세", "전체 아니면 12세", "등급 미정", "제한상영가"]) {
    assert.equal(normalizeMvDesiredRating(input), "", String(input));
  }
});
