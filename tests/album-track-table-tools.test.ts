import assert from "node:assert/strict";
import test from "node:test";

import {
  appendAlbumTrackRowKey,
  createAlbumTrackRowKeyState,
  mergeAlbumTrackPasteRows,
  moveAlbumTrackRowKey,
  parseAlbumTrackTablePaste,
  removeAlbumTrackRowKey,
  resizeAlbumTrackRowKeyState,
} from "../src/lib/album-track-table";

type TestTrack = {
  trackTitle: string;
  performer: string;
  featuring: string;
  composer: string;
  lyricist: string;
  arranger: string;
  lyrics: string;
  isTitle: boolean;
};

const initialTrack = (): TestTrack => ({
  trackTitle: "",
  performer: "",
  featuring: "",
  composer: "",
  lyricist: "",
  arranger: "",
  lyrics: "",
  isTitle: false,
});

test("row keys stay stable across delete, reorder, resize, and append", () => {
  const initial = createAlbumTrackRowKeyState(3, "draft 42");
  assert.deepEqual(initial.keys, ["draft-42-1", "draft-42-2", "draft-42-3"]);

  const removed = removeAlbumTrackRowKey(initial, 1);
  assert.deepEqual(removed.keys, ["draft-42-1", "draft-42-3"]);

  const appended = appendAlbumTrackRowKey(removed);
  assert.deepEqual(appended.keys, ["draft-42-1", "draft-42-3", "draft-42-4"]);
  assert.equal(appended.nextSequence, 5);

  const moved = moveAlbumTrackRowKey(appended, 2, 0);
  assert.deepEqual(moved.keys, ["draft-42-4", "draft-42-1", "draft-42-3"]);

  const resized = resizeAlbumTrackRowKeyState(moved, 5);
  assert.deepEqual(resized.keys, [
    "draft-42-4",
    "draft-42-1",
    "draft-42-3",
    "draft-42-5",
    "draft-42-6",
  ]);
  assert.equal(resizeAlbumTrackRowKeyState(resized, 5), resized);
});

test("TSV paste recognizes Korean headers and preserves quoted text", () => {
  const pasted = [
    "곡명\t가수명\t작곡가\t작사가\t편곡가\t메모",
    '첫 곡\t가수 A\t"작곡, A"\t작사 A\t편곡 A\t무시',
    "둘째 곡\t가수 B\t작곡 B\t작사 B\t편곡 B\t무시",
  ].join("\n");

  const result = parseAlbumTrackTablePaste(pasted);

  assert.equal(result.delimiter, "\t");
  assert.equal(result.hasHeader, true);
  assert.deepEqual(result.ignoredHeaders, ["메모"]);
  assert.deepEqual(result.rows, [
    {
      trackTitle: "첫 곡",
      performer: "가수 A",
      composer: "작곡, A",
      lyricist: "작사 A",
      arranger: "편곡 A",
    },
    {
      trackTitle: "둘째 곡",
      performer: "가수 B",
      composer: "작곡 B",
      lyricist: "작사 B",
      arranger: "편곡 B",
    },
  ]);
});

test("CSV parser supports escaped quotes and multiline quoted cells", () => {
  const result = parseAlbumTrackTablePaste(
    'Track Title,Artist,Composer\n"Hello, World","Singer ""A""","Kim\nLee"',
  );

  assert.equal(result.delimiter, ",");
  assert.equal(result.hasHeader, true);
  assert.deepEqual(result.rows, [
    {
      trackTitle: "Hello, World",
      performer: 'Singer "A"',
      composer: "Kim\nLee",
    },
  ]);
  assert.deepEqual(result.issues, []);
});

test("headerless rows follow the on-screen field order", () => {
  const result = parseAlbumTrackTablePaste(
    "첫 곡\t가수 A\t작곡 A\t작사 A\t편곡 A",
  );

  assert.equal(result.hasHeader, false);
  assert.deepEqual(result.rows, [
    {
      trackTitle: "첫 곡",
      performer: "가수 A",
      composer: "작곡 A",
      lyricist: "작사 A",
      arranger: "편곡 A",
    },
  ]);
});

test("paste merge preserves compilation performers and track-only data", () => {
  const compilationTrack: TestTrack = {
    ...initialTrack(),
    trackTitle: "기존 곡",
    performer: "개별 가수",
    lyrics: "기존 가사",
    isTitle: true,
  };
  const parsed = parseAlbumTrackTablePaste(
    "곡명\t작곡가\n수정한 곡\t공통 작곡가\n새 곡\t새 작곡가",
  );

  const merged = mergeAlbumTrackPasteRows(
    [compilationTrack],
    parsed.rows,
    initialTrack,
  );

  assert.deepEqual(merged[0], {
    ...compilationTrack,
    trackTitle: "수정한 곡",
    composer: "공통 작곡가",
  });
  assert.equal(merged[0].performer, "개별 가수");
  assert.equal(merged[0].lyrics, "기존 가사");
  assert.equal(merged[0].isTitle, true);
  assert.deepEqual(merged[1], {
    ...initialTrack(),
    trackTitle: "새 곡",
    composer: "새 작곡가",
  });
});
