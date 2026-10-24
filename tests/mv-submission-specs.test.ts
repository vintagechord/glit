import assert from "node:assert/strict";
import test from "node:test";
import { getSelectedBroadcastSpecs, kbsMvPurposeNote } from "../src/lib/mv-submission-specs";

test("broadcast guidance includes only selected stations and identifies KBS source applicability", () => {
  const selected = getSelectedBroadcastSpecs(["KBS"]);
  assert.deepEqual(selected.map((spec) => spec.id), ["KBS"]);
  const kbs = selected[0];
  assert.ok(kbs.fields.duration && kbsMvPurposeNote.includes(kbs.fields.duration));
  assert.equal(kbs.fields.maxSize, "1.5GB 이하");
  assert.equal(kbs.source?.url, "https://review.riak.or.kr/community.asp?inx=3");
  assert.match(kbs.fields.note ?? "", /접수 경로의 적용 규격은 담당자 확인이 필요/);
  assert.match(kbs.fields.note ?? "", /MXF는 현재 사이트 업로드 대상이 아니/);
  assert.deepEqual(getSelectedBroadcastSpecs(["SBS", "MBC"]).map((spec) => spec.id), ["MBC", "SBS"]);
  assert.deepEqual(getSelectedBroadcastSpecs(["ETN"]), []);
});
