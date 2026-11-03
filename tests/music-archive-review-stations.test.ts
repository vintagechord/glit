import assert from "node:assert/strict";
import { test } from "node:test";

import { groupReviewRecordsByStation } from "../src/features/music-archive/review-stations";
import type { ArchiveTask, ArchiveTrack } from "../src/lib/music-archive/model";

const track = (id: string, trackNumber: number): ArchiveTrack => ({ id, releaseId: "album", title: `곡 ${trackNumber}`, discNumber: 1, trackNumber, managed: true, excluded: false, links: [], userEdited: true } as ArchiveTrack);
const task = (trackId: string, agency: string, result: ArchiveTask["result"], extra: Partial<ArchiveTask> = {}): ArchiveTask => ({
  id: `${agency}:${trackId}:${result}`, trackId, kind: "review", agency, status: "completed", result, source: "user_input", queryStatus: "unsupported", attachmentIds: [], ...extra,
} as ArchiveTask);

const tracks = [track("t1", 1), track("t2", 2), track("t3", 3)];

test("album records fold into one row per station in broadcaster order", () => {
  const rows = groupReviewRecordsByStation([
    task("t1", "MBC", "eligible"), task("t2", "MBC", "eligible"), task("t3", "MBC", "eligible"),
    task("t2", "KBS", "eligible"), task("t1", "KBS", "eligible"), task("t3", "KBS", "ineligible", { memo: "가사 표현" }),
  ], tracks);
  assert.deepEqual(rows.map(row => row.agency), ["KBS", "MBC"]);
  const [kbs, mbc] = rows;
  assert.equal(kbs.label, "1곡 부적격");
  assert.equal(kbs.tone, "bauhaus-status-chip--danger");
  assert.deepEqual(kbs.entries.map(entry => entry.task.trackId), ["t1", "t2", "t3"]);
  assert.equal(kbs.entries[2].task.memo, "가사 표현");
  assert.match(kbs.logoSrc ?? "", /kbs/);
  assert.equal(mbc.label, "적격");
  assert.equal(mbc.summary, null);
});

test("incomplete, in-progress and single-song stations keep honest labels", () => {
  const [partial] = groupReviewRecordsByStation([task("t1", "SBS", "eligible"), task("t2", "SBS", "eligible")], tracks);
  assert.equal(partial.label, "2곡 적격");
  assert.equal(partial.summary, "1곡 미입력");

  const [progress] = groupReviewRecordsByStation([task("t1", "YTN", "eligible"), task("t2", "YTN", "unknown", { status: "submitted" })], tracks);
  assert.equal(progress.label, "심의 진행 중");

  const [single] = groupReviewRecordsByStation([task("t1", "CBS", "ineligible")], [tracks[0]]);
  assert.equal(single.label, "부적격");

  const [other] = groupReviewRecordsByStation([task("t1", "기타 방송사", "eligible")], [tracks[0]]);
  assert.equal(other.logoSrc, null);
  assert.equal(other.label, "적격");
});

test("several histories of one song at one station count as one song", () => {
  const [row] = groupReviewRecordsByStation([task("t1", "KBS", "ineligible"), { ...task("t1", "KBS", "ineligible"), id: "history-2" }], tracks);
  assert.equal(row.label, "1곡 부적격");
  assert.equal(row.entries.length, 2);
});
