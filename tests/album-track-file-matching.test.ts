import assert from "node:assert/strict";
import test from "node:test";

import {
  getAlbumTrackFileName,
  isAlbumTrackAudioFileName,
  matchAlbumTracksToAudioFiles,
  normalizeAlbumTrackMatchName,
} from "../src/lib/album-track-file-matching";

test("normalizes paths, Unicode width, punctuation, extension, and track prefix", () => {
  assert.equal(
    normalizeAlbumTrackMatchName("C:\\audio\\01 - Ｈｅｌｌｏ, World!.WAV"),
    "helloworld",
  );
  assert.equal(normalizeAlbumTrackMatchName("[02] 봄 날.mp3"), "봄날");
  assert.equal(isAlbumTrackAudioFileName("track.FLAC"), true);
  assert.equal(isAlbumTrackAudioFileName("application.docx"), false);
  assert.equal(
    getAlbumTrackFileName({
      originalName: "original.wav",
      name: "name.mp3",
      path: "bucket/path.flac",
    }),
    "original.wav",
  );
});

test("matches unique normalized titles and reports missing and extra files", () => {
  const result = matchAlbumTracksToAudioFiles(
    [{ trackTitle: "첫 곡" }, { trackTitle: "Second Song" }, { trackTitle: "누락곡" }],
    [
      { originalName: "01_첫-곡.wav" },
      { originalName: "Second_Song.MP3" },
      { originalName: "extra.flac" },
      { originalName: "신청서.docx" },
    ],
  );

  assert.deepEqual(result.matches, [
    {
      trackIndex: 0,
      fileIndex: 0,
      reason: "normalized-title",
      normalizedName: "첫곡",
    },
    {
      trackIndex: 1,
      fileIndex: 1,
      reason: "normalized-title",
      normalizedName: "secondsong",
    },
  ]);
  assert.deepEqual(result.missingTrackIndexes, [2]);
  assert.deepEqual(result.unmatchedFileIndexes, [2]);
  assert.deepEqual(result.unsupportedFileIndexes, [3]);
});

test("numbered duplicate titles match their own rows without ambiguity", () => {
  const result = matchAlbumTracksToAudioFiles(
    [{ trackTitle: "Same Song" }, { trackTitle: "Same Song" }],
    [
      { name: "01 - Same Song.wav" },
      { name: "02 - Same Song.wav" },
    ],
  );

  assert.deepEqual(
    result.matches.map(({ trackIndex, fileIndex, reason }) => ({
      trackIndex,
      fileIndex,
      reason,
    })),
    [
      { trackIndex: 0, fileIndex: 0, reason: "track-number" },
      { trackIndex: 1, fileIndex: 1, reason: "track-number" },
    ],
  );
  assert.deepEqual(result.missingTrackIndexes, []);
  assert.deepEqual(result.unmatchedFileIndexes, []);
  assert.deepEqual(result.duplicateTrackTitles, [
    { normalizedName: "samesong", indexes: [0, 1] },
  ]);
  assert.deepEqual(result.duplicateFileNames, [
    { normalizedName: "samesong", indexes: [0, 1] },
  ]);
});

test("duplicate unnumbered files remain unmatched instead of guessing", () => {
  const result = matchAlbumTracksToAudioFiles(
    [{ trackTitle: "Same Song" }],
    [{ name: "Same Song.wav" }, { name: "Same-Song.mp3" }],
  );

  assert.deepEqual(result.matches, []);
  assert.deepEqual(result.missingTrackIndexes, [0]);
  assert.deepEqual(result.unmatchedFileIndexes, [0, 1]);
  assert.deepEqual(result.duplicateFileNames, [
    { normalizedName: "samesong", indexes: [0, 1] },
  ]);
});

test("track-number fallback refuses a mismatched title", () => {
  const result = matchAlbumTracksToAudioFiles(
    [{ trackTitle: "Correct Song" }],
    [{ name: "01 - Different Song.wav" }],
  );

  assert.deepEqual(result.matches, []);
  assert.deepEqual(result.missingTrackIndexes, [0]);
  assert.deepEqual(result.unmatchedFileIndexes, [0]);
});
