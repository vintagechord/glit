import assert from "node:assert/strict";
import test from "node:test";
import { reviewAlbumSchema, reviewDocumentDataSchema, reviewSourceSchema, type ReviewDocumentData } from "../src/lib/review-docs/model";
import { getReviewRetrySourceIds, mergeRetryExtraction } from "../src/lib/review-docs/retry";

function fixture(): ReviewDocumentData {
  return reviewDocumentDataSchema.parse({ mode: "album", applicationDate: "2026-09-07",
    sources: [{ id: "source-one", kind: "melon", name: "첫 원본", text: "original source" }],
    albums: [{ id: "album-one", title: "앨범", artistName: "가수", company: "원본 기획사", sourceIds: ["source-one"],
      tracks: [{ id: "track-one", number: 1, title: "노래", sourceIds: ["source-one"], lyricStatus: "extraction_failed",
        evidence: [{ sourceId: "source-one", field: "lyrics", location: "old", excerpt: "" }] }],
    }],
  });
}
function recovered(data = fixture()) {
  const result = structuredClone(data);
  result.sources[0].text = "recovered source"; result.sources[0].warnings = [];
  result.albums[0].tracks[0].lyrics = "다시 찾은 가사";
  result.albums[0].tracks[0].lyricStatus = "provided";
  result.albums[0].tracks[0].evidence = [{ sourceId: "source-one", field: "lyrics", location: "new", excerpt: "다시 찾은 가사" }];
  return result;
}

test("retry selection includes only job-owned failed sources and unedited failed lyric sources", () => {
  const data = fixture();
  data.sources.push(reviewSourceSchema.parse({ id: "broken", kind: "file", name: "실패", text: "" }));
  data.sources.push(reviewSourceSchema.parse({ id: "ocr", kind: "file", name: "OCR 검토", text: "추출 완료" }));
  data.issues.push({ id: "ocr-review", code: "EXTRACTION_REVIEW", severity: "error", sourceId: "ocr", message: "검토" });
  data.issues.push({ id: "url-error", code: "URL_EXTRACTION_FAILED", severity: "error", sourceId: "not-this-job", message: "실패" });
  assert.deepEqual(getReviewRetrySourceIds(data, [{ id: "source-one" }, { id: "broken" }, { id: "ocr" }, { id: "broken" }]), ["source-one", "broken"]);
  data.albums[0].tracks[0].reviewedFields = ["lyrics"];
  assert.deepEqual(getReviewRetrySourceIds(data, data.sources), ["broken"]);
});

test("recovered lyric updates source and evidence without replacing administrator metadata", () => {
  const current = fixture(); const next = recovered();
  current.albums[0].title = "관리자가 수정한 앨범";
  current.albums[0].company = ""; current.albums[0].reviewedFields = ["company", "title"];
  current.albums[0].tracks[0].title = "관리자가 수정한 곡명";
  current.albums[0].tracks[0].composer = "직접 입력 작곡가";
  current.albums[0].tracks[0].reviewedFields = ["title", "composer"];
  const saved = [JSON.stringify(current), JSON.stringify(next)];
  const result = mergeRetryExtraction(current, next);
  assert.equal(result.albums.length, 1); assert.equal(result.albums[0].tracks.length, 1);
  assert.equal(result.albums[0].title, "관리자가 수정한 앨범"); assert.equal(result.albums[0].company, "");
  assert.equal(result.albums[0].tracks[0].title, "관리자가 수정한 곡명");
  assert.equal(result.albums[0].tracks[0].composer, "직접 입력 작곡가");
  assert.equal(result.albums[0].tracks[0].lyrics, "다시 찾은 가사");
  assert.equal(result.albums[0].tracks[0].lyricStatus, "provided");
  assert.deepEqual(result.albums[0].tracks[0].evidence, next.albums[0].tracks[0].evidence);
  assert.equal(result.sources[0].text, "recovered source");
  assert.deepEqual([JSON.stringify(current), JSON.stringify(next)], saved);
});

test("retry never overwrites manual lyrics, explicit blanks or confirmed instrumental state", () => {
  for (const kind of ["typed", "blank", "status", "instrumental"] as const) {
    const data = fixture(); const next = recovered(); const track = data.albums[0].tracks[0];
    // A second failed song keeps this source eligible even when the first was manually resolved.
    data.albums[0].tracks.push({ ...structuredClone(track), id: "track-two", number: 2 });
    if (kind === "typed") track.lyrics = "관리자 가사";
    if (kind === "blank") track.reviewedFields = ["lyrics"];
    if (kind === "status") track.reviewedFields = ["lyricStatus"];
    if (kind === "instrumental") track.instrumentalConfirmed = true;
    const result = mergeRetryExtraction(data, next);
    assert.deepEqual(result.albums[0].tracks[0], track);
  }
});

test("whole-source recovery adds previously missing albums and resolves only collection failures", () => {
  const data = fixture(); data.albums = []; data.sources[0].text = "";
  data.issues = [
    { id: "source:source-one", code: "CONVERTER_TIMEOUT", severity: "error", sourceId: "source-one", message: "시간 초과" },
    { id: "manual-conflict", code: "FIELD_CONFLICT", severity: "error", sourceId: "source-one", message: "수동 확인 필요" },
  ];
  data.confirmedIssueIds = ["source:source-one", "manual-conflict"];
  const result = mergeRetryExtraction(data, recovered());
  assert.equal(result.albums.length, 1);
  assert.deepEqual(result.issues.map((issue) => issue.id), ["manual-conflict"]);
  assert.deepEqual(result.confirmedIssueIds, ["manual-conflict"]);
  assert.equal(result.sources[0].text, "recovered source");
});

test("file re-extraction matches unique same-source number and title despite regenerated parser IDs", () => {
  const data = fixture(); const next = recovered();
  next.albums[0].id = "random-new-album"; next.albums[0].tracks[0].id = "random-new-track";
  next.issues.push({ id: "new-warning", code: "SOURCE_NOTE", severity: "warning", albumId: "random-new-album", trackId: "random-new-track", sourceId: "source-one", message: "원문 확인" });
  const result = mergeRetryExtraction(data, next);
  assert.equal(result.albums.length, 1); assert.equal(result.albums[0].tracks.length, 1);
  assert.equal(result.albums[0].id, "album-one"); assert.equal(result.albums[0].tracks[0].id, "track-one");
  assert.equal(result.albums[0].tracks[0].lyrics, "다시 찾은 가사");
  assert.equal(result.issues[0].albumId, "album-one"); assert.equal(result.issues[0].trackId, "track-one");
});

test("ambiguous recovered album is preserved separately with a blocking manual merge issue", () => {
  const data = fixture(); const next = recovered();
  next.albums[0].id = "different-parser-id"; next.albums[0].title = "재추출 원문 제목";
  const result = mergeRetryExtraction(data, next);
  assert.equal(result.albums.length, 2); assert.equal(result.albums[0].title, "앨범");
  assert.equal(result.albums[1].title, "재추출 원문 제목");
  assert.notEqual(result.albums[1].tracks[0].id, result.albums[0].tracks[0].id);
  assert.ok(result.issues.some((issue) => issue.code === "REEXTRACTION_ALBUM_MATCH_REQUIRED" && issue.severity === "error"));
});

test("a repeated failure retains good source text, draft tracks and a retryable unconfirmed error", () => {
  const data = fixture(); const failed = fixture(); failed.albums = []; failed.sources[0].text = "";
  failed.issues = [{ id: "url-error", code: "URL_EXTRACTION_FAILED", severity: "error", sourceId: "source-one", message: "다시 실패" }];
  data.confirmedIssueIds = ["url-error"];
  const result = mergeRetryExtraction(data, failed);
  assert.equal(result.sources[0].text, "original source");
  assert.deepEqual(result.albums, data.albums); assert.equal(result.issues[0].message, "다시 실패");
  assert.deepEqual(result.confirmedIssueIds, []);
  assert.deepEqual(getReviewRetrySourceIds(result, result.sources), ["source-one"]);
});

test("unrelated successful sources are ignored and snapshot date changes are rejected", () => {
  const data = fixture(); const next = recovered();
  next.sources.push(reviewSourceSchema.parse({ id: "unknown", kind: "file", name: "작업 외부", text: "원문" }));
  next.albums.push(reviewAlbumSchema.parse({ id: "unknown-album", title: "외부 앨범", sourceIds: ["unknown"], tracks: [] }));
  const result = mergeRetryExtraction(data, next);
  assert.equal(result.sources.length, 1); assert.equal(result.albums.length, 1);
  next.applicationDate = "2026-09-08";
  assert.throws(() => mergeRetryExtraction(data, next), /신청일자/);
});

test("empty parser album names are not enough to merge identities, and total merged source limits still apply", () => {
  const data = fixture(); const next = recovered();
  data.albums[0].title = ""; data.albums[0].artistName = "";
  next.albums[0].title = ""; next.albums[0].artistName = ""; next.albums[0].id = "new-parser-id";
  assert.equal(mergeRetryExtraction(data, next).albums.length, 2);
  data.sources.push(reviewSourceSchema.parse({ id: "other", kind: "file", name: "성공 원본", text: "가".repeat(400_000) }));
  next.sources[0].text = "나".repeat(200_001);
  assert.throws(() => mergeRetryExtraction(data, next), /전체 원문/);
  assert.equal(data.sources[0].text, "original source");
});
