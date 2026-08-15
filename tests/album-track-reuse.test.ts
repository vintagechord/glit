import assert from "node:assert/strict";
import test from "node:test";

import {
  applyAlbumTrackCreditsToBlankTracks,
  createAlbumTrackWithReusableCredits,
  type AlbumTrackReusableCredits,
} from "../src/lib/album-track-reuse";

type TestTrack = AlbumTrackReusableCredits & {
  trackTitle: string;
  featuring: string;
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

test("new tracks copy only trimmed performer and credit fields", () => {
  const initial = initialTrack();
  const source: TestTrack = {
    trackTitle: "원곡 제목",
    performer: "  공통 가수  ",
    featuring: "피처링 가수",
    composer: "  공통 작곡가 ",
    lyricist: " 공통 작사가  ",
    arranger: "  공통 편곡가 ",
    lyrics: "복사하면 안 되는 가사",
    isTitle: true,
  };

  const created = createAlbumTrackWithReusableCredits(initial, source);

  assert.deepEqual(created, {
    ...initial,
    performer: "공통 가수",
    composer: "공통 작곡가",
    lyricist: "공통 작사가",
    arranger: "공통 편곡가",
  });
  assert.equal(created.trackTitle, "");
  assert.equal(created.featuring, "");
  assert.equal(created.lyrics, "");
  assert.equal(created.isTitle, false);
  assert.notEqual(created, initial);
  assert.deepEqual(initial, initialTrack());
  assert.equal(source.performer, "  공통 가수  ");
});

test("bulk reuse fills only blank credits and preserves compilation overrides", () => {
  const source: TestTrack = {
    ...initialTrack(),
    trackTitle: "기준 트랙",
    performer: "  앨범 가수  ",
    composer: " 공통 작곡 ",
    lyricist: "공통 작사",
    arranger: " 공통 편곡 ",
  };
  const blankTarget: TestTrack = {
    ...initialTrack(),
    trackTitle: "빈 트랙",
    performer: "   ",
  };
  const compilationTarget: TestTrack = {
    ...initialTrack(),
    trackTitle: "컴필레이션 트랙",
    performer: "다른 가수",
    composer: "다른 작곡가",
    lyricist: "다른 작사가",
    arranger: "다른 편곡가",
  };
  const tracks = [source, blankTarget, compilationTarget] as const;

  const result = applyAlbumTrackCreditsToBlankTracks(tracks, 0);

  assert.notEqual(result, tracks);
  assert.equal(result[0], source);
  assert.deepEqual(result[0], source);
  assert.deepEqual(result[1], {
    ...blankTarget,
    performer: "앨범 가수",
    composer: "공통 작곡",
    lyricist: "공통 작사",
    arranger: "공통 편곡",
  });
  assert.equal(result[2], compilationTarget);
  assert.deepEqual(result[2], compilationTarget);
  assert.equal(blankTarget.performer, "   ");
});

test("blank source values do not erase initial defaults or target values", () => {
  const initial = {
    ...initialTrack(),
    performer: "초기 가수",
    composer: "초기 작곡가",
  };
  const blankSource = {
    ...initialTrack(),
    performer: " ",
    composer: "",
  };

  assert.deepEqual(createAlbumTrackWithReusableCredits(initial, blankSource), initial);

  const target = {
    ...initialTrack(),
    trackTitle: "대상",
    performer: "개별 가수",
  };
  const applied = applyAlbumTrackCreditsToBlankTracks(
    [blankSource, target],
    0,
  );
  assert.equal(applied[0], blankSource);
  assert.equal(applied[1], target);
});

test("invalid source indexes return an immutable shallow copy", () => {
  const tracks = [initialTrack()];
  const result = applyAlbumTrackCreditsToBlankTracks(tracks, -1);

  assert.notEqual(result, tracks);
  assert.equal(result[0], tracks[0]);
  assert.deepEqual(result, tracks);
});
